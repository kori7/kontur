"""Merge the downloaded sources into one dataset with our classes.

    python scripts/train/prepare-dataset.py [--only corrosion-detection bolts own]

Reads scripts/train/sources.json, takes each source from .models/rfdetr/sources/<id>/ and writes
.models/rfdetr/dataset/ in Roboflow COCO format, ready for train-rfdetr.py. Sources whose folder is
missing are skipped with a note. Prints how many images and boxes of each class landed in each split.
"""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

from kontur_training import CLASSES, SPLITS, merge  # noqa: E402

SOURCES_ROOT = ROOT / ".models" / "rfdetr" / "sources"
DATASET = ROOT / ".models" / "rfdetr" / "dataset"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="идентификаторы источников из sources.json")
    parser.add_argument("--config", type=Path, default=HERE / "sources.json")
    parser.add_argument("--sources", type=Path, default=SOURCES_ROOT)
    parser.add_argument("--out", type=Path, default=DATASET)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8"))
    chosen = [item for item in config["sources"] if not args.only or item["id"] in args.only]
    present = [item for item in chosen if (args.sources / item["id"]).is_dir()]
    for item in chosen:
        if item not in present:
            print(f"Пропущен {item['id']}: нет папки {args.sources / item['id']}")
    if not present:
        raise SystemExit("Нет ни одного скачанного источника")
    report = merge(present, args.sources, args.out)
    print(f"Выборка: {args.out}")
    print("Часть   | фото | " + " | ".join(CLASSES))
    for split in SPLITS:
        counts = report["counts"][split]
        print(f"{split:7} | {counts['images']:4} | " + " | ".join(str(counts[name]) for name in CLASSES))
    if report["moved_duplicates"]:
        print(f"Копий одного снимка перенесено в одну часть выборки: {report['moved_duplicates']}")
    if not report["counts"]["test"]["images"]:
        print("Внимание: в test нет снимков. Полноту мерить не на чем — нужны собственные снимки (источник own).")


if __name__ == "__main__":
    main()

"""Turn a Hugging Face object-detection dataset (parquet) into a Roboflow COCO source folder.

    python scripts/train/import-parquet.py <folder with *.parquet> <source id> \
        --classes corrosion-0 Slippage corrosion crack --placeholder corrosion-0

Roboflow 100 sets on Hugging Face keep each split as one parquet file with the image bytes and COCO
boxes ([x, y, width, height] in pixels). This writes .models/rfdetr/sources/<id>/{train,valid,test}/
with the images and _annotations.coco.json, the layout prepare-dataset.py merges. --classes lists the
dataset's class names in id order; --placeholder names Roboflow's never-annotated supercategory.

Roboflow 100 splits frames of one video at random, so the test part holds near-copies of training
frames and would overstate the score. --drop-near-train N removes test images whose 16×16 average
hash is within N bits of any training image; the count goes to IMPORT.json next to the splits.
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPLITS = {"train": "train", "validation": "valid", "valid": "valid", "test": "test"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder", type=Path)
    parser.add_argument("source_id")
    parser.add_argument("--classes", nargs="+", required=True)
    parser.add_argument("--placeholder", default=None)
    parser.add_argument("--out", type=Path, default=ROOT / ".models" / "rfdetr" / "sources")
    parser.add_argument("--drop-near-train", type=int, default=None, metavar="BITS")
    args = parser.parse_args()
    import pyarrow.parquet as pq

    categories = [{"id": index, "name": name, "supercategory": "none" if name == args.placeholder else "objects"}
                  for index, name in enumerate(args.classes)]
    for path in sorted(args.folder.glob("*.parquet")):
        split = SPLITS[path.name.split("-")[0]]
        target = args.out / args.source_id / split
        target.mkdir(parents=True, exist_ok=True)
        images, annotations = [], []
        for row in pq.read_table(path).to_pylist():
            name = f"{split}-{row['image_id']}.jpg"
            (target / name).write_bytes(row["image"]["bytes"])
            images.append({"id": row["image_id"], "file_name": name, "width": row["width"], "height": row["height"]})
            objects = row["objects"]
            for box, category in zip(objects["bbox"], objects["category"]):
                annotations.append({"id": len(annotations), "image_id": row["image_id"], "category_id": category,
                                    "bbox": [float(value) for value in box], "area": float(box[2] * box[3]),
                                    "iscrowd": 0})
        (target / "_annotations.coco.json").write_text(json.dumps(
            {"images": images, "annotations": annotations, "categories": categories}), encoding="utf-8")
        print(f"{args.source_id}/{split}: {len(images)} снимков, {len(annotations)} рамок")
    if args.drop_near_train is not None:
        dropped = drop_near_train(args.out / args.source_id, args.drop_near_train)
        (args.out / args.source_id / "IMPORT.json").write_text(json.dumps(
            {"dropped_from_test": dropped, "bits": args.drop_near_train}, ensure_ascii=False, indent=2),
            encoding="utf-8")
        print(f"Из test убрано почти-копий кадров train: {len(dropped)}")


def average_hash(path: Path) -> int:
    from PIL import Image

    pixels = list(Image.open(path).convert("L").resize((16, 16)).getdata())
    mean = sum(pixels) / len(pixels)
    return sum(1 << index for index, value in enumerate(pixels) if value > mean)


def drop_near_train(folder: Path, bits: int) -> list[str]:
    train = json.loads((folder / "train" / "_annotations.coco.json").read_text(encoding="utf-8"))
    hashes = [average_hash(folder / "train" / image["file_name"]) for image in train["images"]]
    path = folder / "test" / "_annotations.coco.json"
    test = json.loads(path.read_text(encoding="utf-8"))
    near = lambda own: min(bin(own ^ other).count("1") for other in hashes) <= bits  # noqa: E731
    dropped = {image["id"]: image["file_name"] for image in test["images"]
               if near(average_hash(folder / "test" / image["file_name"]))}
    test["images"] = [image for image in test["images"] if image["id"] not in dropped]
    test["annotations"] = [item for item in test["annotations"] if item["image_id"] not in dropped]
    path.write_text(json.dumps(test), encoding="utf-8")
    for name in dropped.values():
        (folder / "test" / name).unlink()
    return sorted(dropped.values())


if __name__ == "__main__":
    main()

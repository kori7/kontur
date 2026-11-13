"""Read-only library over the supplied organizer materials.

Files are addressed by their manifest identifier, never by a path from the request: the identifier is
looked up in ``data/registry/sources.json`` and the resolved path is checked to stay inside the
organizer directory. A request cannot name a file that the manifest does not list.

Every entry carries its stage A classification, so the interface shows what a file actually is before
anyone reuses it: a stock photograph with a visible watermark and a generated image are both served
for review, and both are marked as inadmissible for training or publication.
"""

from pathlib import Path

from app import registry

ORGANIZER = Path(__file__).resolve().parents[3] / "data/reference/organizer"

MEDIA_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
IMAGE_VIEWS = {"installed_external", "disassembled_part", "sectioned_sample", "collage"}
PROVENANCE_LABELS = {
    "photograph": "Фотография",
    "generated_watermark": "Сгенерировано (водяной знак Qwen)",
    "stock_watermark": "Сток с водяным знаком",
    "supplied_document": "Переданный документ",
    "unknown": "Происхождение не установлено",
}
USE_LABELS = {
    "candidate": "Допущен в обучающую выборку",
    "illustration_only": "Только как иллюстрация",
    "excluded": "Исключён",
}
VIEW_LABELS = {
    "installed_external": "Смонтированное оборудование, наружный осмотр",
    "disassembled_part": "Разобранный узел",
    "sectioned_sample": "Разрушающий контроль",
    "collage": "Монтаж из нескольких кадров",
    "document": "Документ",
    "series": "Ряд измерений",
}


def _entry(item: dict) -> dict:
    suffix = Path(item["path"]).suffix.lower()
    return {
        "id": item["id"],
        "category": item["category_as_supplied"],
        "shows": item["shows"],
        "view": item["view"],
        "view_label": VIEW_LABELS.get(item["view"], item["view"]),
        "provenance": item["provenance"],
        "provenance_label": PROVENANCE_LABELS.get(item["provenance"], item["provenance"]),
        "editing": item["editing"],
        "training_use": item["training_use"],
        "training_use_label": USE_LABELS[item["training_use"]],
        "note": item["note"],
        "duplicate_of": item.get("duplicate_of"),
        "subject": item.get("subject"),
        "bytes": item["bytes"],
        "media_type": MEDIA_TYPES.get(suffix),
        "viewable_in_browser": MEDIA_TYPES.get(suffix) in ("image/png", "image/jpeg", "application/pdf"),
        "original_name": Path(item["original_path"].replace("\\", "/")).name,
    }


def list_library() -> dict:
    """Group the supplied files for review, keeping the counts the inventory reported."""
    sources = registry.load_sources()["sources"]
    images = [_entry(item) for item in sources if item["view"] in IMAGE_VIEWS]
    documents = [_entry(item) for item in sources if item["view"] == "document"]
    series = [_entry(item) for item in sources if item["view"] == "series"]
    return {
        "images": images,
        "documents": documents,
        "series": series,
        "totals": {
            "files": len(sources),
            "images": len(images),
            "unique_images": len([item for item in images if item["duplicate_of"] is None]),
            "training_candidates": len([item for item in images if item["training_use"] == "candidate"]),
            "documents": len(documents),
        },
        "notice": ("Классификация выполнена при инвентаризации этапа A и проверена одним человеком. "
                   "Файлы с водяным знаком и сгенерированные кадры показаны для обзора, но для обучения "
                   "и публикации непригодны."),
    }


def resolve(source_id: str) -> tuple[Path, str, str]:
    """Return the file path, media type and download name for one manifest identifier."""
    item = next((item for item in registry.load_sources()["sources"] if item["id"] == source_id), None)
    if item is None:
        raise KeyError(source_id)
    media_type = MEDIA_TYPES.get(Path(item["path"]).suffix.lower())
    if media_type is None:
        raise ValueError("Формат файла не поддерживается для выдачи.")
    root = ORGANIZER.resolve()
    path = (root / item["path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise KeyError(source_id)
    return path, media_type, Path(item["path"]).name

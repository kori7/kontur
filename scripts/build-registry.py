"""Merge the organizer manifest with the stage A manual inspection into data/registry/sources.json.

Every classification below was set by looking at the file itself. Checksums, sizes and paths are
copied from the manifest so they are never retyped. ``provenance`` records what the file shows about
its own origin, not a guess: ``stock_watermark`` and ``generated_watermark`` mean a visible mark,
``unknown`` means the origin could not be established from the file. A second reviewer is expected to
re-check the table and record disagreement in docs/stage-a-inventory.md.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/reference/organizer"
TARGET = ROOT / "data/registry/sources.json"

# id: (shows, view, provenance, editing, training_use, note)
# view: installed_external | disassembled_part | sectioned_sample | document | series | collage
# provenance: photograph | generated_watermark | stock_watermark | unknown
IMAGES = {
    "pumps-001": ("motor_terminal_box", "installed_external", "generated_watermark", "none",
                  "illustration_only", "Обугленная изоляция кабелей и подгар на клеммной колодке. Водяной знак Qwen."),
    "pumps-002": ("centrifugal_pump_unit", "installed_external", "generated_watermark", "none",
                  "illustration_only", "Общий вид агрегата: отслоение краски, коррозия рамы и фланцев. Водяной знак Qwen."),
    "pumps-003": ("rolling_bearing", "disassembled_part", "photograph", "none",
                  "excluded", "Вскрытый подшипник с загрязнённой смазкой. Внутренний узел, камерой на смонтированном агрегате не виден."),
    "pumps-004": ("centrifugal_pump_seal", "installed_external", "generated_watermark", "none",
                  "illustration_only", "Подтёк у уплотнения вала, шильд CENTRIFUGAL PUMP CP-400. Водяной знак Qwen."),
    "pumps-005": ("pump_baseplate_fasteners", "installed_external", "generated_watermark", "none",
                  "illustration_only", "Анкер без гайки на раме, маркировка пола P-104. Водяной знак Qwen."),
    "pumps-006": ("motor_terminal_box", "installed_external", "photograph", "none",
                  "candidate", "Клеммная колодка со снятой крышкой, заземляющий проводник на месте. Отрицательный пример к подгару."),
    "pumps-007": ("centrifugal_pump_unit", "installed_external", "unknown", "none",
                  "excluded", "Композиция совпадает с pumps-002, но водяного знака нет и попиксельного совпадения тоже. Происхождение не установлено."),
    "pumps-008": ("pump_seal_area", "installed_external", "photograph", "none",
                  "candidate", "Пар и тёмная жидкость у уплотнения работающего насоса."),
    "pumps-009": ("pump_threaded_joint", "installed_external", "photograph", "none",
                  "candidate", "Коррозия и кристаллизация у резьбового соединения на корпусе."),
    "pumps-010": ("pump_stem_seal_plate", "installed_external", "photograph", "none",
                  "candidate", "Ржавчина на штоке и опорной шайбе того же красного насоса, что и pumps-009."),
    "pumps-011": ("valve_or_pump_body", "installed_external", "photograph", "none",
                  "candidate", "Смоченный корпус, коррозия резьбового соединения, мокрое пятно на полу. Байт-в-байт совпадает с valves-008."),
    "pumps-012": ("pump_impeller", "disassembled_part", "photograph", "none",
                  "excluded", "Эрозия и сквозные раковины рабочего колеса. Внутренний узел."),
    "pumps-013": ("gate_valve", "installed_external", "photograph", "none",
                  "candidate", "Задвижка на изолированном трубопроводе: сплошная коррозия, наросты, подтёк. По содержанию это арматура, а не насос."),
    "pumps-014": ("centrifugal_pump_unit", "installed_external", "photograph", "none",
                  "candidate", "Два насоса в насосной, общий план, поверхностная коррозия."),
    "pumps-015": ("motor_terminal_box", "installed_external", "photograph", "none",
                  "candidate", "Подгоревшая клеммная колодка, опилки, зелёный проводник заземления."),
    "pumps-016": ("motor_terminal_box", "installed_external", "photograph", "none",
                  "candidate", "Тот же агрегат, что и pumps-015, другой ракурс. В один сплит с pumps-015."),
    "pumps-017": ("motor_terminal_box", "installed_external", "photograph", "none",
                  "candidate", "Подгар на крайней клемме в оцинкованном корпусе."),
    "pumps-018": ("pump_stem_seal_plate", "installed_external", "photograph", "none",
                  "excluded", "Повтор pumps-010 в JPEG."),
    "pumps-019": ("pump_threaded_joint", "installed_external", "photograph", "none",
                  "excluded", "Повтор pumps-009 в JPEG."),
    "pumps-020": ("pump_bearing_housing", "installed_external", "photograph", "none",
                  "candidate", "Чёрно-белый кадр: замасленный корпус подшипника и шкив."),
    "pumps-021": ("pipe_flange_joint", "installed_external", "photograph", "none",
                  "candidate", "Коррозия фланцевого соединения вертикального стояка. По содержанию это трубопровод."),
    "pumps-022": ("multistage_pump_casing", "installed_external", "photograph", "none",
                  "candidate", "Секционный корпус многоступенчатого насоса с раскрытыми стыками секций."),
    "motors-001": ("rolling_bearing", "disassembled_part", "photograph", "none",
                   "excluded", "Повреждённый сепаратор подшипника. Внутренний узел."),
    "motors-002": ("stator_core", "disassembled_part", "photograph", "none",
                   "excluded", "Шихтованный сердечник статора в мастерской. Внутренний узел."),
    "motors-003": ("bearing_race", "disassembled_part", "photograph", "none",
                   "excluded", "Выкрашивание дорожки качения, чёрно-белый кадр. Внутренний узел."),
    "motors-004": ("motor_cooling_fins", "installed_external", "generated_watermark", "none",
                   "illustration_only", "Обломанные рёбра охлаждения и забитые грязью каналы. Водяной знак Qwen."),
    "motors-005": ("stator_winding", "disassembled_part", "photograph", "none",
                   "excluded", "Лобовые части обмотки на верстаке. Внутренний узел."),
    "motors-006": ("motor_cooling_fan", "disassembled_part", "photograph", "none",
                   "excluded", "Снятая крыльчатка с обломанными лопастями. Снимается вместе с кожухом."),
    "motors-007": ("motor_end_shield", "installed_external", "generated_watermark", "none",
                   "illustration_only", "Отслоение краски и коррозия подшипникового щита. Водяной знак Qwen."),
    "motors-008": ("metal_surface", "disassembled_part", "photograph", "none",
                   "excluded", "Макро выкрашивания металла без узнаваемого узла. Предмет съёмки не определён."),
    "motors-009": ("stator_winding", "disassembled_part", "photograph", "none",
                   "excluded", "Выгоревший участок обмотки статора. Внутренний узел."),
    "motors-010": ("stator_winding", "disassembled_part", "photograph", "annotation_burned_in",
                   "excluded", "Выгоревшая обмотка с врисованным красным овалом. Разметка вшита в пиксели."),
    "motors-011": ("motor_rotor_and_hub", "collage", "photograph", "collage",
                   "excluded", "Два кадра в одном файле плюс штамп даты 01.01.2004. Не один объект съёмки."),
    "pipes-001": ("pipe_weld_seam", "installed_external", "photograph", "background_removed",
                  "illustration_only", "Коррозия сварного шва с каплями. Фон вырезан и заменён."),
    "pipes-002": ("pipe_weld_seam", "installed_external", "photograph", "none",
                  "candidate", "Продольная трещина по сварному шву, макро."),
    "pipes-003": ("pipe_surface", "installed_external", "photograph", "none",
                  "candidate", "Поверхность трубы большого диаметра с локальным дефектом, монтажная площадка."),
    "pipes-004": ("pipe_body", "installed_external", "photograph", "none",
                  "candidate", "Продольная трещина по телу трубы."),
    "pipes-005": ("pipe_body", "installed_external", "photograph", "none",
                  "candidate", "Раскрытая продольная трещина трубы."),
    "pipes-006": ("pipe_wall", "sectioned_sample", "photograph", "none",
                  "excluded", "Срез стенки трубы с утонением. Разрушающий контроль, камерой на объекте не воспроизводится."),
    "pipes-007": ("pipe_body", "installed_external", "photograph", "none",
                  "candidate", "Сквозные язвенные перфорации на корродированной трубе."),
    "pipes-008": ("pipe_insulation", "installed_external", "photograph", "none",
                  "candidate", "Разорванная обечайка и вскрытая минеральная вата, ремонт скотчем."),
    "pipes-009": ("pipe_flange_joint", "installed_external", "stock_watermark", "none",
                  "excluded", "Коррозия фланцевого соединения. Водяной знак Shutterstock, ID 2738414417."),
    "pipes-010": ("valve_stem_gland", "installed_external", "stock_watermark", "none",
                  "excluded", "Кристаллизация продукта под сальником штока. Водяной знак Shutterstock, ID 2840981719."),
    "pipes-011": ("pipe_flange_joint", "installed_external", "stock_watermark", "none",
                  "excluded", "Коррозия фланца на открытой площадке. Водяной знак Shutterstock, ID 2733059369."),
    "pipes-012": ("pipe_joint", "installed_external", "photograph", "none",
                  "candidate", "Коррозия сварного стыка трубы с растрескиванием покрытия."),
    "valves-001": ("gate_valve", "installed_external", "stock_watermark", "none",
                   "excluded", "Ржавая задвижка у воды. Водяной знак Alamy."),
    "valves-002": ("gate_valve", "installed_external", "stock_watermark", "background_removed",
                   "excluded", "Ржавая задвижка на белом фоне. Водяной знак Alamy, фон вырезан."),
    "valves-003": ("valve_insulation", "installed_external", "photograph", "none",
                   "candidate", "Разорванная изоляция арматуры с подтёком снизу."),
    "valves-004": ("butterfly_valve_disc", "disassembled_part", "photograph", "none",
                   "excluded", "Диск затвора DN80 PN16 с коррозией и сквозным отверстием, снят с линии."),
    "valves-005": ("brass_valve", "installed_external", "unknown", "none",
                   "excluded", "Затяжка сальниковой гайки ключом, белые высолы на корпусе. Происхождение не установлено."),
    "valves-006": ("ball_valve", "installed_external", "unknown", "none",
                   "excluded", "Струи из корпуса шарового крана на студийном фоне. Происхождение не установлено."),
    "valves-007": ("gate_valve", "installed_external", "photograph", "none",
                   "candidate", "Задвижка в приямке в тумане, высолы на штоке и фланцах."),
    "valves-008": ("valve_or_pump_body", "installed_external", "photograph", "none",
                   "excluded", "Байт-в-байт повтор pumps-011 в другой категории организатора."),
    "valves-009": ("valve_stem_gland", "installed_external", "photograph", "none",
                   "candidate", "Нарост кристаллизовавшегося продукта на сальнике штока."),
    "valves-010": ("valve_flange_joint", "installed_external", "photograph", "none",
                   "candidate", "Формирующаяся капля рыжей жидкости на фланцевом соединении."),
}

DUPLICATES = {"pumps-018": "pumps-010", "pumps-019": "pumps-009", "valves-008": "pumps-011"}

# id: (kind, subject, note)
DOCUMENTS = {
    "manuals-001": ("equipment_passport", "pcp-21031004-1", "Паспорт AMS PCP60S12/3 01 Ex B1 HNBR DTS, серийный 21031004-1. Ресурс, срок службы, характеристики, комплектность."),
    "manuals-002": ("equipment_passport", "pcp-21031004-2", "Паспорт того же типа, серийный 21031004-2."),
    "manuals-003": ("equipment_passport", "pcp-21031004-3", "Паспорт того же типа, серийный 21031004-3. Скан бледный."),
    "manuals-004": ("equipment_passport", "pcp-21031004-4", "Паспорт того же типа, серийный 21031004-4."),
    "manuals-005": ("component_passport", "motor-230201069", "Паспорт ДТ.525000.038 ПС на двигатель BRA160M4 ГБУ1, заводской номер 230201069."),
    "manuals-006": ("component_passport", "gearbox-SAL023020084", "Паспорт на редуктор WXRF87-AM160-5.30-M1-ø300, №SAL023020084_001, количество 4 шт."),
    "manuals-007": ("component_passport", "motor-230201070", "Паспорт того же типа на двигатель с заводским номером 230201070."),
    "manuals-008": ("conformity_declaration", "ams-pcp-series", "Декларация ЕАЭС N RU Д-RU.KA01.B.21968/20 на серию AMS PCP, действительна по 27.02.2025."),
    "manuals-009": ("operating_manual", "ams-pcp-series", "Инструкция по эксплуатации серии AMS PCP: спецификация АМС.07.ВН.000.00, интервалы осмотра, моменты затяжки, таблица неисправностей."),
    "manuals-010": ("component_manual", "gearbox-series-rfks", "Руководство пользователя мотор-редукторов WANSHSIN серии R.F.K.S."),
    "manuals-011": ("datasheet", "tag-860-P-0201", "Опросный лист на насос откачки нефтешлама, 2 шт., позиция 860-P-0201-A,B, объект КНГК-ИНПЗ."),
    "manuals-012": ("datasheet", "tag-860-P-0601", "Опросный лист на насос откачки нефтешлама, 2 шт., позиция 860-P-0601-A,B, объект КНГК-ИНПЗ."),
    "manuals-013": ("document_index", "project-21031004", "Перечень документов проекта №21031004 из 17 позиций: показывает, какие документы комплекта не переданы."),
    "manuals-014": ("lubrication_list", "project-21031004", "Перечень смазочных материалов по узлам: редуктор, соединение вал-полый вал, шарнирные узлы."),
    "manuals-015": ("safety_manual", "connection_fittings", "Инструкция по безопасности на присоединительную арматуру, ГОРЭЛТЕХ."),
    "manuals-016": ("component_manual", "eldin-motor-series", "Руководство по эксплуатации взрывозащищённых двигателей ELDIN ДТ.520205.061 РЭ."),
    "manuals-017": ("protection_setpoints", "project-21031004", "Перечень блокировок и сигнализации: уставки DTS и PTC обмотки статора."),
    "manuals-018": ("measurement_approval", "pt-0304-vt", "Свидетельство об утверждении типа ПТ 0304-ВТ, ОС.С.32.004.А №76974, срок до 24.03.2025."),
    "manuals-019": ("conformity_certificate", "eldin-motor-series", "Сертификат ТР ТС 012/2011 на двигатели ELDIN, срок действия истёк 28.06.2023."),
    "manuals-020": ("unrelated_task", None, "Задание хакатона «Башкирская языковая школа». К оборудованию отношения не имеет."),
    "manuals-021": ("task_statement", "kontur", "Задача хакатона «Кибер 102» от КСТ ЭНЕРГО ИНЖИНИРИНГ — постановка этого проекта."),
    "manuals-022": ("unrelated_task", None, "Задание хакатона на VR-тренажёр АО «Салаватстекло». К оборудованию отношения не имеет."),
    "manuals-023": ("vendor_catalogue", "fcr-15-30", "Каталог центробежных многоступенчатых насосов FCR 15-30. Другой тип насоса, не проектный."),
    "manuals-024": ("vendor_catalogue", "hf-series", "Каталог насосов серии HF. Другой тип насоса, не проектный."),
    "guides-001": ("defect_guide", None, "Типы дефектов промышленного оборудования: 6 групп, из них к проекту относятся только двигатели и арматура."),
    "vibration-001": ("sensor_series", "unconfirmed", "500 записей с часовым шагом: обороты, СКЗ, 1x, 2x, ВЧ шум, столбец диагноза."),
    "vibration-002": ("series_description", "unconfirmed", "Описание вибрационного ряда и его уставок."),
    "temperature-001": ("sensor_series", "unconfirmed", "500 записей с часовым шагом: обороты, температура подшипника, температура обмоток, столбец диагноза."),
    "temperature-002": ("series_description", "unconfirmed", "Описание температурного ряда и его уставок."),
}


def build() -> dict:
    entries = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8-sig"))
    classified, missing = [], []
    for entry in entries:
        record = {"id": entry["id"], "category_as_supplied": entry["category"],
                  "path": entry["path"], "sha256": entry["sha256"], "bytes": entry["bytes"],
                  "original_path": entry["original_path"]}
        if entry["id"] in IMAGES:
            shows, view, provenance, editing, use, note = IMAGES[entry["id"]]
            record |= {"shows": shows, "view": view, "provenance": provenance, "editing": editing,
                       "training_use": use, "note": note,
                       "duplicate_of": DUPLICATES.get(entry["id"])}
        elif entry["id"] in DOCUMENTS:
            kind, subject, note = DOCUMENTS[entry["id"]]
            record |= {"shows": kind, "view": "series" if kind.startswith("sensor") else "document",
                       "provenance": "supplied_document", "editing": "none",
                       "training_use": "excluded", "note": note, "subject": subject,
                       "duplicate_of": None}
        else:
            missing.append(entry["id"])
            continue
        classified.append(record)
    if missing:
        raise SystemExit(f"Нет классификации для файлов: {missing}")
    return {
        "schema_version": 1,
        "manifest": {"path": "data/reference/organizer/manifest.json", "entry_count": len(entries)},
        "classified_by": "stage A manual inspection, second review pending",
        "sources": classified,
    }


if __name__ == "__main__":
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(TARGET)

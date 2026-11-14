"""Diagnostic rules for the documented equipment, derived only from supplied documents.

Every threshold here is quoted from a file in ``data/reference/organizer`` and is named in the rule's
``basis``. Nothing is carried over from the synthetic centrifugal rules: that equipment has sensors
this equipment does not have.

What these objects actually measure is two parameters — a Pt100 dry-run sensor and a discrete PTC in
the stator winding. Everything else a rule may use is either something the engineer measures with a
named instrument, something visible, or a date from the journal. A rule whose input is absent returns
``insufficient`` and names what is missing; it never returns «норма».
"""

from datetime import datetime, timedelta, timezone

RULES_VERSION = "documented-1.0.0"

# Thresholds quoted from the supplied documents. The citation travels with the value.
THRESHOLDS = {
    "dts_setpoint_c": 100.0,          # manuals-017, устанавливаемая величина и блокировка, макс.
    "dts_critical_c": 105.0,          # manuals-017, критический параметр
    "ptc_critical_c": 160.0,          # manuals-017, критический параметр обмотки статора
    "seal_over_product_k": 20.0,      # manuals-009 §7.1, измеряется пирометром
    "gland_drip_min_per_min": 5.0,    # manuals-009 §8.1.4, нижняя граница штатной утечки
    "gland_drip_max_per_min": 20.0,   # manuals-009 §8.1.4, верхняя граница штатной утечки
    "gland_run_in_max_per_min": 200.0,  # manuals-009 §8.1.4, первоначальная настройка
    "motor_vibration_mm_s": 2.2,      # manuals-005, ГОСТ IEC 60034-14-2014, категория A
    "weekly_interval_days": 7,        # manuals-009 §8.1.1
    "quarterly_interval_days": 90,    # manuals-009 §8.1.1
    "wear_parts_hours": 3000.0,       # manuals-001, быстроизнашиваемые детали
    "wear_parts_months": 12,          # manuals-001
}

# Inputs an engineer can actually supply for these objects, with the instrument named.
MEASUREMENTS = {
    "pcp_pump_unit": {
        "dts_temperature_c": {"label": "Температура датчика сухого хода DTS", "unit": "°C",
                              "kind": "number", "instrument": "ПТ 0304Эх-ВТ, 1×Pt100",
                              "basis": "manuals-017; поверка по manuals-018"},
        "stator_ptc_tripped": {"label": "Сработал PTC обмотки статора", "unit": "",
                               "kind": "boolean", "instrument": "Реле РТЗ-1М",
                               "basis": "manuals-017; выход дискретный, градусов не даёт"},
        "product_temperature_c": {"label": "Температура перекачиваемого продукта", "unit": "°C",
                                  "kind": "number", "instrument": "Штатный контроль процесса",
                                  "basis": "manuals-001: рабочий диапазон +5…+45 °C"},
        "seal_surface_temperature_c": {"label": "Температура уплотнения, пирометр", "unit": "°C",
                                       "kind": "number", "instrument": "Пирометр",
                                       "basis": "manuals-009 §7.1"},
        "gland_drip_rate_per_min": {"label": "Утечка уплотнения", "unit": "капель/мин",
                                    "kind": "number", "instrument": "Подсчёт за минуту",
                                    "basis": "manuals-009 §8.1.4"},
        "abnormal_noise": {"label": "Посторонний шум или стук", "unit": "",
                           "kind": "boolean", "instrument": "Слуховой контроль",
                           "basis": "manuals-009 §8.1.1, еженедельно"},
        "runtime_hours": {"label": "Наработка агрегата", "unit": "ч", "kind": "number",
                          "instrument": "Счётчик наработки",
                          "basis": "manuals-001: ресурс до списания не менее 11 000 ч"},
    },
    "induction_motor": {
        "stator_ptc_tripped": {"label": "Сработал PTC обмотки статора", "unit": "",
                               "kind": "boolean", "instrument": "Реле РТЗ-1М",
                               "basis": "manuals-017; выход дискретный"},
        "vibration_velocity_mm_s": {"label": "Виброскорость корпуса двигателя", "unit": "мм/с",
                                    "kind": "number", "instrument": "Виброметр",
                                    "basis": "manuals-005: категория A, не более 2,2 мм/с"},
    },
    "gear_reducer": {},
}
SEAL_TYPE_MECHANICAL = "mechanical"
SEAL_TYPE_GLAND = "gland"


def _missing(*names: str) -> tuple[None, list[str]]:
    return None, list(names)


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _days_since(events: list[dict], action: str, now: datetime) -> float | None:
    """Days since the latest event of this action for the object, or None when there is none."""
    stamps = []
    for event in events:
        if event.get("action") != action:
            continue
        try:
            moment = datetime.fromisoformat(event["created_at"])
        except (KeyError, TypeError, ValueError):
            continue
        stamps.append(moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc))
    if not stamps:
        return None
    return (now - max(stamps)).total_seconds() / 86400


class Inputs:
    """Available inputs for one object, each kept distinguishable from an absent one."""

    def __init__(self, equipment_type, measurements, findings, events, card, now):
        self.equipment_type = equipment_type
        self.measurements = measurements or {}
        self.findings = {item["class_id"]: item for item in findings or []}
        self.events = events or []
        self.card = card or {}
        self.now = now

    def value(self, key):
        if key not in self.measurements:
            return _missing(f"measurements.{key}")
        value = _number(self.measurements[key])
        return (value, []) if value is not None else _missing(f"measurements.{key}")

    def flag(self, key):
        if key not in self.measurements:
            return _missing(f"measurements.{key}")
        value = self.measurements[key]
        return (bool(value), []) if isinstance(value, bool) else _missing(f"measurements.{key}")

    def finding(self, class_id):
        item = self.findings.get(class_id)
        if item is None:
            return _missing(f"findings.{class_id}")
        return bool(item.get("present")), []

    def days_since(self, action):
        days = _days_since(self.events, action, self.now)
        return (days, []) if days is not None else _missing(f"journal.{action}")

    def seal_type(self):
        materials = self.card.get("materials") or {}
        if "mechanical_seal" in materials:
            return SEAL_TYPE_MECHANICAL
        return None

    def commissioned_at(self):
        raw = self.card.get("commissioned_at")
        if not isinstance(raw, str):
            return _missing("equipment.commissioned_at")
        try:
            return datetime.fromisoformat(raw).replace(tzinfo=timezone.utc), []
        except ValueError:
            return _missing("equipment.commissioned_at")


def _dry_run(inputs: Inputs):
    value, missing = inputs.value("dts_temperature_c")
    if missing:
        return None, missing, []
    critical = value >= THRESHOLDS["dts_critical_c"]
    triggered = value >= THRESHOLDS["dts_setpoint_c"]
    evidence = [{"label": "Температура DTS, °C", "value": value,
                 "threshold": f"Уставка и блокировка ≥ {THRESHOLDS['dts_setpoint_c']:.0f} °C; "
                              f"критическое значение {THRESHOLDS['dts_critical_c']:.0f} °C",
                 "source": "Измерение инженера; уставка — перечень блокировок manuals-017"}]
    return triggered, [], evidence + ([{"label": "Критический параметр достигнут", "value": "да",
                                        "threshold": f"≥ {THRESHOLDS['dts_critical_c']:.0f} °C",
                                        "source": "manuals-017"}] if critical else [])


def _ptc(inputs: Inputs):
    value, missing = inputs.flag("stator_ptc_tripped")
    if missing:
        return None, missing, []
    return value, [], [{"label": "Сигнал PTC обмотки статора", "value": "сработал" if value else "не сработал",
                        "threshold": f"Критическое значение {THRESHOLDS['ptc_critical_c']:.0f} °C; "
                                     "выход дискретный, числовой температуры нет",
                        "source": "manuals-017, реле РТЗ-1М"}]


def _seal_overheat(inputs: Inputs):
    surface, missing_surface = inputs.value("seal_surface_temperature_c")
    product, missing_product = inputs.value("product_temperature_c")
    missing = missing_surface + missing_product
    if missing:
        return None, missing, []
    margin = surface - product
    return margin > THRESHOLDS["seal_over_product_k"], [], [
        {"label": "Превышение над температурой продукта, K", "value": round(margin, 1),
         "threshold": f"Не более {THRESHOLDS['seal_over_product_k']:.0f} K",
         "source": "manuals-009 §7.1; измеряется пирометром, RGB-камера этого не измеряет"},
        {"label": "Температура уплотнения, °C", "value": surface,
         "threshold": "Пирометр", "source": "Измерение инженера"},
    ]


def _seal_leak(inputs: Inputs):
    rate, missing_rate = inputs.value("gland_drip_rate_per_min")
    visible, missing_visible = inputs.finding("seal_leak_excessive")
    seal_type = inputs.seal_type()
    if seal_type == SEAL_TYPE_MECHANICAL:
        if missing_visible:
            return None, missing_visible, []
        return visible, [], [{"label": "Видимая утечка торцевого уплотнения",
                              "value": "признак есть" if visible else "признак не обнаружен",
                              "threshold": "Для одинарного торцевого уплотнения штатной утечки не предусмотрено",
                              "source": "manuals-001: уплотнение одинарное торцевое, карбид вольфрама / карбид кремния"}]
    if missing_rate:
        return None, missing_rate + ["equipment.materials.seal_type"], []
    low, high = THRESHOLDS["gland_drip_min_per_min"], THRESHOLDS["gland_drip_max_per_min"]
    outside = rate > high or rate < low
    return outside, [], [{"label": "Утечка сальника, капель/мин", "value": rate,
                          "threshold": f"Штатный режим {low:.0f}–{high:.0f} капель/мин: "
                                       "меньше нормы означает перетянутый сальник и перегрев пары трения",
                          "source": "manuals-009 §8.1.4"}]


def _overdue(inputs: Inputs, action: str, interval_key: str, what: str):
    days, missing = inputs.days_since(action)
    if missing:
        return None, missing, [{"label": what, "value": "записей в журнале нет",
                                "threshold": f"Интервал {THRESHOLDS[interval_key]} сут",
                                "source": "manuals-009 §8.1.1"}]
    limit = THRESHOLDS[interval_key]
    return days > limit, [], [{"label": what, "value": f"{days:.1f} сут назад",
                               "threshold": f"Интервал {limit} сут при работе 8 ч в день, 5 суток в неделю",
                               "source": "manuals-009 §8.1.1"}]


def _wear_parts(inputs: Inputs):
    hours, missing_hours = inputs.value("runtime_hours")
    commissioned, missing_date = inputs.commissioned_at()
    missing = missing_hours + missing_date
    if missing:
        return None, missing, [{"label": "Предел быстроизнашиваемых деталей",
                                "value": f"{THRESHOLDS['wear_parts_months']} мес или "
                                         f"{THRESHOLDS['wear_parts_hours']:.0f} ч",
                                "threshold": "Ротор, статор, уплотнение, шарниры",
                                "source": "manuals-001, условия гарантии"}]
    by_hours = hours >= THRESHOLDS["wear_parts_hours"]
    by_date = inputs.now >= commissioned + timedelta(days=30 * THRESHOLDS["wear_parts_months"])
    return by_hours or by_date, [], [
        {"label": "Наработка, ч", "value": hours,
         "threshold": f"Предел {THRESHOLDS['wear_parts_hours']:.0f} ч", "source": "manuals-001"},
        {"label": "С момента ввода в эксплуатацию", "value": commissioned.date().isoformat(),
         "threshold": f"Предел {THRESHOLDS['wear_parts_months']} мес", "source": "manuals-001"},
    ]


def _motor_vibration(inputs: Inputs):
    value, missing = inputs.value("vibration_velocity_mm_s")
    if missing:
        return None, missing, []
    return value > THRESHOLDS["motor_vibration_mm_s"], [], [
        {"label": "Виброскорость, мм/с", "value": value,
         "threshold": f"Допуск паспорта {THRESHOLDS['motor_vibration_mm_s']} мм/с "
                      "для частоты вращения свыше 600 мин⁻¹",
         "source": "manuals-005, ГОСТ IEC 60034-14-2014, категория A"}]


def _visible(class_id: str, label: str, basis: str):
    def rule(inputs: Inputs):
        present, missing = inputs.finding(class_id)
        if missing:
            return None, missing, []
        return present, [], [{"label": label, "value": "признак есть" if present else "признак не обнаружен",
                              "threshold": "Визуальное наблюдение инженера", "source": basis}]
    return rule


RULES = (
    {"id": "P01", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "stator"},
     "title": "Достигнута уставка защиты от сухого хода",
     "severity": "critical", "evaluate": _dry_run,
     "hypothesis": "Температура в зоне статора достигла уставки защиты DTS. Перечень блокировок "
                   "предписывает отключение насосного агрегата.",
     "recommendation": "Проверить наличие продукта во всасывающей линии и срабатывание защиты. "
                       "Пуск «всухую» инструкция запрещает.",
     "basis": "manuals-017, перечень блокировок и сигнализации; manuals-009 §7.1"},
    {"id": "P02", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "motor"},
     "title": "Сработала термисторная защита обмотки статора",
     "severity": "critical", "evaluate": _ptc,
     "hypothesis": "PTC обмотки статора разомкнут. Это дискретный сигнал превышения, а не измеренная "
                   "температура: градусов обмотки агрегат не измеряет.",
     "recommendation": "Привлечь электротехнический персонал. Работы — после безопасной остановки и "
                       "изоляции энергии по регламенту.",
     "basis": "manuals-017; реле РТЗ-1М из комплектности manuals-001"},
    {"id": "P03", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "seal_housing"},
     "title": "Уплотнение горячее продукта более чем на 20 K",
     "severity": "warning", "evaluate": _seal_overheat,
     "hypothesis": "Инструкция ограничивает нагрев статора и уплотнения относительно температуры "
                   "рабочей жидкости. Превышение указывает на ухудшение условий работы пары трения.",
     "recommendation": "Повторить замер пирометром, проверить настройку уплотнения и режим подачи.",
     "basis": "manuals-009 §7.1"},
    {"id": "P04", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "seal_housing"},
     "title": "Утечка уплотнения вне штатного режима",
     "severity": "warning", "evaluate": _seal_leak,
     "hypothesis": "Для сальникового исполнения штатной является капельная утечка 5–20 капель в минуту: "
                   "и превышение, и её отсутствие означают неисправность. Для одинарного торцевого "
                   "уплотнения видимая утечка штатной не является.",
     "recommendation": "Для сальника — отрегулировать вкладыш крышки по §8.1.4. Для торцевого "
                       "уплотнения — передать ответственному специалисту.",
     "basis": "manuals-009 §8.1.4 и таблица неисправностей §8.2, причина 13"},
    {"id": "P05", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "pump_casing"},
     "title": "Просрочен еженедельный осмотр",
     "severity": "info",
     "evaluate": lambda inputs: _overdue(inputs, "inspection", "weekly_interval_days",
                                         "Последний осмотр в журнале"),
     "hypothesis": "Еженедельно проверяются герметичность соединений и наличие постороннего шума. "
                   "Срок последнего осмотра в журнале превышен.",
     "recommendation": "Выполнить осмотр по §8.1.1 и записать результат в журнал.",
     "basis": "manuals-009 §8.1.1; за еженедельный контроль принята запись действия «Проверка»"},
    {"id": "P06", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "stud"},
     "title": "Просрочен квартальный контроль затяжки и крепления",
     "severity": "info",
     "evaluate": lambda inputs: _overdue(inputs, "maintenance", "quarterly_interval_days",
                                         "Последнее обслуживание в журнале"),
     "hypothesis": "Раз в 3 месяца проверяются плотность затяжки патрубка, статора, корпуса, опорного "
                   "фланца и привода, а также крепление насоса.",
     "recommendation": "Проверить моменты затяжки по таблице §8.1.3 динамометрическим ключом. "
                       "Изображением момент затяжки не измеряется.",
     "basis": "manuals-009 §8.1.1 и §8.1.3; за квартальный контроль принята запись «Обслуживание»"},
    {"id": "P07", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "stator"},
     "title": "Исчерпан предел быстроизнашиваемых деталей",
     "severity": "warning", "evaluate": _wear_parts,
     "hypothesis": "Паспорт ограничивает срок использования ротора, статора, уплотнения и шарниров "
                   "12 месяцами при наработке 3000 ч. Это граница гарантии, а не прогноз отказа.",
     "recommendation": "Сверить фактическую наработку и дату ввода с журналом; состав ЗИП на год "
                       "эксплуатации указан в комплектности паспорта.",
     "basis": "manuals-001, условия гарантии и комплектность"},
    {"id": "P08", "types": ("pcp_pump_unit",), "components": {"pcp_pump_unit": "guard"},
     "title": "Отсутствует защитный кожух",
     "severity": "critical",
     "evaluate": _visible("guard_missing", "Отсутствие защитного кожуха",
                          "manuals-001: опция «Защитный кожух» — Да"),
     "hypothesis": "Признак отсутствия кожуха вращающихся частей действует независимо от любых "
                   "измерений.",
     "recommendation": "Не приближаться к вращающимся частям, сообщить ответственному специалисту.",
     "basis": "manuals-001, раздел «Опции»"},
    {"id": "M01", "types": ("induction_motor",), "components": {"induction_motor": "stator_winding"},
     "title": "Сработала термисторная защита обмотки",
     "severity": "critical", "evaluate": _ptc,
     "hypothesis": "PTC в обмотке статора разомкнут. Сигнал дискретный; измеренной температуры "
                   "обмотки у двигателя нет.",
     "recommendation": "Привлечь электротехнический персонал по регламенту.",
     "basis": "manuals-005, опция «PTC терморезисторы»; уставка — manuals-017"},
    {"id": "M02", "types": ("induction_motor",), "components": {"induction_motor": "motor_frame"},
     "title": "Виброскорость выше паспортного допуска",
     "severity": "warning", "evaluate": _motor_vibration,
     "hypothesis": "Паспорт задаёт допустимую виброскорость 2,2 мм/с для двигателей с частотой "
                   "вращения свыше 600 мин⁻¹. Это допуск самого двигателя, а не уставка агрегата в сборе.",
     "recommendation": "Повторить замер, проверить крепление лап и соосность привода.",
     "basis": "manuals-005, ГОСТ IEC 60034-14-2014, категория A"},
    {"id": "M03", "types": ("induction_motor",), "components": {"induction_motor": "earth_terminal"},
     "title": "Отсутствует проводник заземления",
     "severity": "critical",
     "evaluate": _visible("earth_conductor_missing", "Отсутствие проводника заземления",
                          "manuals-009 §7.1: перед запуском заземлить оборудование в обозначенных знаком местах"),
     "hypothesis": "Инструкция требует заземления в местах, обозначенных знаком, до запуска.",
     "recommendation": "Не включать оборудование. Восстановить заземление силами электротехнического "
                       "персонала.",
     "basis": "manuals-009 §7.1; guides-001 §1"},
    {"id": "M04", "types": ("induction_motor",), "components": {"induction_motor": "cooling_fins"},
     "title": "Повреждение рёбер охлаждения",
     "severity": "warning",
     "evaluate": _visible("cooling_fin_damage", "Повреждение или загрязнение рёбер охлаждения",
                          "guides-001 §1"),
     "hypothesis": "Обломанные или забитые рёбра ухудшают охлаждение корпуса. Температуру обмотки "
                   "этот признак не измеряет.",
     "recommendation": "Очистить межрёберные каналы, оценить объём повреждения оребрения.",
     "basis": "guides-001 §1"},
    {"id": "G01", "types": ("gear_reducer",), "components": {"gear_reducer": "gearbox_housing"},
     "title": "Подтёк масла на корпусе редуктора",
     "severity": "warning",
     "evaluate": _visible("oil_leak_at_housing", "Маслянистый подтёк на корпусе",
                          "guides-001 §3; заправка VG220 3,7 л по manuals-006 и manuals-014"),
     "hypothesis": "Подтёк от прокладок крышки, фланца или пробки означает потерю заправки "
                   "синтетического масла VG220.",
     "recommendation": "Определить место подтёка, проверить уровень масла и состояние уплотнений "
                       "по руководству мотор-редукторов.",
     "basis": "manuals-006, manuals-014, guides-001 §3"},
    {"id": "G02", "types": ("gear_reducer",), "components": {"gear_reducer": "gearbox_output_flange"},
     "title": "Просрочен квартальный контроль затяжки привода",
     "severity": "info",
     "evaluate": lambda inputs: _overdue(inputs, "maintenance", "quarterly_interval_days",
                                         "Последнее обслуживание в журнале"),
     "hypothesis": "Квартальный контроль плотности затяжки прямо включает привод.",
     "recommendation": "Проверить затяжку фланцевого соединения редуктора по таблице §8.1.3.",
     "basis": "manuals-009 §8.1.1 и §8.1.3"},
    {"id": "G03", "types": ("gear_reducer",), "components": {"gear_reducer": "gearbox_oil_plug"},
     "title": "Интервал замены масла не установлен",
     "severity": "info",
     "evaluate": lambda inputs: (None, ["documents.gearbox_oil_change_interval"],
                                 [{"label": "Заправка", "value": "VG220 / Synoil, 3,7 л",
                                   "threshold": "Интервал замены в переданных документах не найден",
                                   "source": "manuals-006, manuals-014"}]),
     "hypothesis": "Марка и объём масла известны, а периодичность замены — нет: раздел с интервалами "
                   "руководства мотор-редукторов в комплект не вошёл.",
     "recommendation": "Запросить у поставщика раздел регламента обслуживания редуктора WXRF87-AM160.",
     "basis": "manuals-006, manuals-014; пробел в комплекте документов"},
)


def rules_for(equipment_type: str) -> list[dict]:
    return [rule for rule in RULES if equipment_type in rule["types"]]


def measurement_vocabulary(equipment_type: str) -> dict:
    return MEASUREMENTS.get(equipment_type, {})


def evaluate_documented(equipment_type: str, measurements: dict | None = None,
                        findings: list[dict] | None = None, events: list[dict] | None = None,
                        card: dict | None = None, now: datetime | None = None) -> dict:
    """Evaluate the documented rule set for one equipment type.

    Returns the same vocabulary the demo engine uses, so the interface renders both the same way:
    ``triggered``, ``clear``, ``insufficient``. An absent input yields ``insufficient`` with the names
    of what is missing, never a verdict.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    inputs = Inputs(equipment_type, measurements, findings, events, card, now)
    results, alerts = [], []
    for rule in rules_for(equipment_type):
        triggered, missing, evidence = rule["evaluate"](inputs)
        status = "insufficient" if triggered is None else ("triggered" if triggered else "clear")
        results.append({"id": rule["id"], "status": status, "missing": missing,
                        "title": rule["title"], "basis": rule["basis"]})
        if triggered is not True:
            continue
        alerts.append({"id": "alert-" + rule["id"].lower(), "rule_ids": [rule["id"]],
                       "title": rule["title"], "component_id": rule["components"][equipment_type],
                       "severity": rule["severity"], "hypothesis": rule["hypothesis"],
                       "recommendation": rule["recommendation"], "evidence": evidence,
                       "requires_inspection": True})
    order = {"critical": 0, "warning": 1, "info": 2}
    alerts.sort(key=lambda alert: (order[alert["severity"]], alert["id"]))
    return {"alerts": alerts, "rule_results": results, "features": {}, "source": "documents",
            "rules_version": RULES_VERSION, "equipment_type": equipment_type,
            "maintenance": {"runtime_hours": None, "norm_hours": None, "remaining_hours": None,
                            "next_service_hours": None, "due_in_hours": None}}

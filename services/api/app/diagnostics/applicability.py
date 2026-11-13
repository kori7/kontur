"""Which equipment types each diagnostic rule may be applied to.

All twelve rules were written for the synthetic centrifugal pump: they read its sensor channels and
name its узлы. None of that transfers to the documented одновинтовой эксцентриковый aggregate, which
has a different operating principle and only two measured parameters. Applying them anyway would
produce a confident «норма» from inputs the equipment does not have.

A rule outside its scope is reported as ``not_applicable`` with a reason, which is a different answer
from ``clear`` («правило не сработало») and from ``insufficient`` («выводу не хватает сведений»).
Rules for the other types are defined from their own documented inputs, which is separate work.
"""

CENTRIFUGAL = ("centrifugal_pump_unit",)

RULE_SCOPE = {rule_id: CENTRIFUGAL for rule_id in
              ("R01", "R02", "R03", "R04", "R05", "R06", "R07", "R08", "R09", "R10", "R11", "R12")}

NOT_APPLICABLE_REASONS = {
    "pcp_pump_unit": {
        "R01": "Штатного измерения температуры и вибрации подшипника у агрегата нет.",
        "R02": "Кавитационные признаки центробежного насоса к объёмному насосу неприменимы.",
        "R03": "Муфты в составе агрегата нет: двигатель соединён с насосом через редуктор и шарнирный вал.",
        "R04": "Расход, давление и мощность не измеряются; проточной части центробежного типа нет.",
        "R05": "Интервалы обслуживания заданы календарно (неделя и 3 месяца), а не по наработке; наработка не измеряется.",
        "R06": "Правило требует роста температуры и вибрации, которых агрегат не измеряет.",
        "R07": "Низкочастотная вибрация и первая гармоника не измеряются.",
        "R08": "Указателя уровня и смотрового окна масла у агрегата нет.",
        "R09": "Фазные токи не измеряются; обмотка защищена дискретным PTC без числового выхода.",
        "R10": "Второго независимого канала давления на участке нет.",
        "R11": "Признак отсутствия кожуха относится к узлу guard и проверяется отдельным визуальным классом, а не этим правилом.",
        "R12": "То же, что и R02.",
    },
}
DEFAULT_REASON = ("Правило написано для синтетического центробежного агрегата и к этому типу "
                  "оборудования не применялось: его входы и узлы здесь отсутствуют.")


def applies_to(rule_id: str, equipment_type: str) -> bool:
    return equipment_type in RULE_SCOPE.get(rule_id, ())


def reason(rule_id: str, equipment_type: str) -> str:
    return NOT_APPLICABLE_REASONS.get(equipment_type, {}).get(rule_id, DEFAULT_REASON)

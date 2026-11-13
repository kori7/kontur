import type {Component} from '../types';
import {number} from '../api';

export function ResourceFacts({component,runtime}:{component:Component;runtime:number|null}) {
  const installedHours=component.last_replacement ? component.last_replacement.analysis.telemetry.runtime_hours : 0;
  const valid=typeof runtime==='number'&&typeof installedHours==='number'&&runtime>=installedHours;
  const used=valid?runtime-installedHours:null;
  const remaining=used===null?null:Math.max(0,component.norm_hours-used);
  return <><div className="detail-facts"><div><small>Наработка узла</small><strong data-testid="component-operating-hours">{used===null?'Недостаточно данных':`${number(used,0)} ч`}</strong></div><div><small>Остаток норматива узла</small><strong>{remaining===null?'Недостаточно данных':`${number(remaining,0)} ч`}</strong></div></div><p className="tiny muted">Расчёт по счётчику агрегата с момента установки или зарегистрированной замены. Это не прогноз времени до отказа.</p></>;
}

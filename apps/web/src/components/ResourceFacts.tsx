import type {Component} from '../types';
import {formatCopy, number} from '../api';

export function ResourceFacts({component,runtime}:{component:Component;runtime:number|null}) {
  const installedHours=component.last_replacement ? component.last_replacement.analysis.telemetry.runtime_hours : 0;
  const valid=typeof runtime==='number'&&typeof installedHours==='number'&&runtime>=installedHours;
  const used=valid?runtime-installedHours:null;
  const norm=component.norm_hours;
  const remaining=used===null||norm===null?null:Math.max(0,norm-used);
  return <><div className="detail-facts"><div><small className="support-copy">Наработка узла</small><strong data-testid="component-operating-hours">{used===null?'Недостаточно данных':`${number(used,0)} ч`}</strong></div><div><small className="support-copy">Остаток норматива узла</small><strong>{norm===null?'Норматив не задан':remaining===null?'Недостаточно данных':`${number(remaining,0)} ч`}</strong></div></div><p className="support-copy">{formatCopy(norm===null?component.norm_source:'По счётчику агрегата с установки или замены')}</p></>;
}

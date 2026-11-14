import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createPumpModel } from './create-pump.js';

window.exportPumpModel = async () => {
  await document.fonts.ready;
  const model = await createPumpModel();
  const output = await new GLTFExporter().parseAsync(model, { binary: true, onlyVisible: false });
  const bytes = new Uint8Array(output);
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
};
document.body.dataset.ready = 'true';

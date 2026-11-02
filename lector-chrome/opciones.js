// Guarda las opciones en chrome.storage.local como ajustes = {panel, clave, vinted, lat?, lon?} (las lee fondo.js)
// y pide permiso para mandar las lecturas a la dirección del panel.
const f = document.getElementById('f'), estado = document.getElementById('estado');

chrome.storage.local.get('ajustes').then(({ ajustes = {} }) => {
  for (const [k, v] of Object.entries(ajustes)) if (f.elements[k]) f.elements[k].value = v;
});

f.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = Object.fromEntries(new FormData(f));
  const numero = (s) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const ajustes = { panel: new URL(v.panel.trim()).origin, clave: v.clave.trim(), vinted: v.vinted.trim(), lat: numero(v.lat), lon: numero(v.lon) };
  if ([ajustes.lat, ajustes.lon].some(Number.isNaN) || (ajustes.lat === null) !== (ajustes.lon === null)) {
    estado.className = 'mal';
    estado.textContent = 'La ubicación necesita los dos números, o ninguno.';
    return;
  }
  // Sin este permiso Chrome no deja mandar las lecturas al panel.
  if (!(await chrome.permissions.request({ origins: [ajustes.panel + '/*'] }))) {
    estado.className = 'mal';
    estado.textContent = 'Sin el permiso para tu panel, la extensión no puede mandarle las lecturas.';
    return;
  }
  await chrome.storage.local.set({ ajustes });
  estado.className = '';
  estado.textContent = 'Guardado. Pulsa el icono de la extensión para hacer la primera lectura.';
});

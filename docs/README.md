Demostración de AGRYN Monitoreo. Es una sola página con datos simulados en el navegador.
Se regenera con `npm run build:demo && node scripts/armar-demo.mjs docs/index.html`.

La silobolsa «Cápsulas AGRYN (en vivo)» muestra los datos reales de las cápsulas: `demo/envivo.js` los lee cada 30 s de la app de Apps Script (`?api=datos`). Para usar otra URL, agregá `?fuente=<url>` a la dirección.

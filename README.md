# Pedidos Amaranta (Frontend)

Sitio estático listo para publicar en **Vercel** bajo `https://pedidos.amaranta.ar`.
Incluye login (DNI + clave), listado de viandas con **foto cuadrada**, **layout alternado**, **stepper 0–9**, resumen, barra inferior con total y modal de confirmación.

> **Backend esperado:** Google Apps Script (GAS) con endpoints `login`, `viandas`, `pedido` y CORS restringido a `https://pedidos.amaranta.ar`.
>
> **Sheet:** `18jX4rlx4hOGIa-6whQT0-jDxcU5UoeL0na655rwDxew`

## Cómo usar
1. Copiá `config/config.example.json` a `config/config.json` y completá tus endpoints de GAS.
2. Subí a GitHub y luego importá en Vercel.
3. Apuntá `pedidos.amaranta.ar` a este proyecto (CNAME) y listo.

### API esperada
- POST `login` → `{ ok, token }`
- GET `viandas` (Bearer token) → `{ ok, items:[{ id,nombre,descripcion,precio,imagen,disponible }], alias? }`
- POST `pedido` (Bearer token) → `{ ok, idPedido, total, alias }`

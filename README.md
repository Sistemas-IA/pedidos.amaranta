# Pedidos Amaranta (Frontend) — v3

- **Una sola pantalla**.
- **Login por POST JSON** (no querystring).
- **Anti-falla:** el `<form>` tiene `method="post"` y `onsubmit="return false"` → si por algún motivo no carga JS, **no navega** ni expone DNI/clave en la URL.
- **Config** ahora es **JS** (`config/config.js`) para compatibilidad total (evitamos JSON modules).

## Configurar
Editá `config/config.js` con tus endpoints y origin.

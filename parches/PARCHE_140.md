# Parche 140 — La supervisora puede registrar TARDANZA

## Problema
La pantalla de TARDANZA de la supervisora solo confirma (siempre 1 hora, sin motivo) y mandaba el motivo vacío. `fn_solicitud_ocurrencia_crear` exige motivo a TARDANZA, SEGURO y PERMISO, así que toda tardanza volvía con «Indica el motivo (hora de salida/regreso)» y no se guardaba. En producción no hay ni una solicitud de TARDANZA de una supervisora; el 21-oct a las 08:45 una llamada volvió sin crear nada.

Los demás tipos sí funcionan: HORA EXTRA y PAGO DE HORA no piden motivo, OTROS lleva su texto, y SEGURO y PERMISO van por `fn_ocurrencia_salida`.

## Cambio
- `fn_solicitud_ocurrencia_crear` (misma firma): TARDANZA ya no exige motivo. SEGURO y PERMISO lo siguen pidiendo por los fronts viejos que los mandan por aquí.
- Front (`app.js`): la supervisora manda el tipo como motivo cuando no hay texto, como ya hacía Ingeniería. Con esto Vercel queda arreglado aunque el SQL no se haya corrido; el SQL arregla Netlify y GitHub Pages.

## Verificar
```sql
select position('''TARDANZA'',''SEGURO''' in pg_get_functiondef(
  'fn_solicitud_ocurrencia_crear(text,uuid,text,text,integer,text,text[],date)'::regprocedure)); -- 0
```
Luego la supervisora registra una tardanza y aparece en Solicitudes pendientes de Ingeniería.

## Deshacer
Correr `parche_140_rollback.sql`.

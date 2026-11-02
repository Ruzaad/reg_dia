# Parche 160 — OFs registradas: lotes de REPROCESO aparte y prenda de SXI367

**Problema (revisión del 2-nov):**
- Las OF 10636, 10637, 10638 y 10639 (SXI367, saco) se registraron **sin prenda**. Su BASE dice `SACO CAB`; la pantalla de alta no la preseleccionó porque el texto de la hoja no la contenía, y dejó confirmar vacío. Sin prenda, la lista las mostraba en CAMISA y PANTALÓN COSTURA "sin BASE".
- Los lotes de REPROCESO (`CAM. MICK 2460 UNID.`, `REETQ.-486UND`, `9CY740`, …) viven en `ofs` desde el parche 126 y la lista de OFs los pintaba como OF con ACABADO y costura "sin BASE".

**Cambio:**
- `fn_ofs_listar` (misma firma y campos) devuelve además `reproceso`.
- A las 4 OF de SXI367 se les pone `SACO CAB` en `ofs.prenda` y `of_detalle.prenda`. Los tickets no cambian (el código del ticket no lleva prenda y `fn_tickets_of_raw` ya las cruzaba).
- Front (sin SQL también funciona): los lotes salen como "REPROCESO · lote"; una OF sin prenda sale con "sin prenda" y solo con ACABADO y las áreas donde hay BASE; el alta de OF ya no deja registrar sin prenda ni con avisos sin marcar "Revisé los avisos".

**Verificar:**
```sql
select o_f, prenda from ofs where articulo = 'SXI367';                        -- 4 filas con SACO CAB
select count(*) from of_detalle where o_f in ('10636','10637','10638','10639') and prenda = 'SACO CAB';  -- 82
```

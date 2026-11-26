# Parche 189 — Tomar tiempos: el catálogo trae las operaciones vigentes de la BASE

**Problema:** el aplicativo estudios-tiempos no mostraba operaciones nuevas de la BASE. En producción 615 operaciones (CAMISA 550, SACO 49, PANTALON 11, ACABADO 4, REPROCESO 1) no tenían fila en la base madre `tiempos_operaciones`, y el catálogo solo trae las que la tienen.

**Cambio:** `fn_tiempos_catalogo` (misma firma) siembra las operaciones faltantes del área antes de armar el catálogo (~140 ms). El trigger también corre al cambiar el nombre de una operación. Se siembra todo ahora. Sin tocar la base madre existente.

**Verificar:** al final del SQL, `bases_sin_madre` = 0. En Tomar tiempos, una operación de un artículo recién subido aparece.

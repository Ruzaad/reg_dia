# Parche 176 — Acabado: cada OF con la base de su prenda

**Problema:** cuando la base de un artículo trae varias prendas (saco + pantalón en el mismo Excel, como TE4563 y TE5247), `fn_acabado_ofs` daba las operaciones de todas las prendas a cada OF, aunque la OF fuera de una sola.

**Cambio:** `fn_acabado_ofs` (misma firma). Si la base trae más de una prenda y la prenda de la OF es una de ellas, la OF solo recibe las operaciones de esa prenda. Una OF con las dos prendas (terno) o con una prenda que no está en la base queda igual.

**Ojo con la base:** subir un Excel de un artículo reemplaza todas sus operaciones, así que saco y pantalón del mismo artículo deben ir juntos en un solo Excel (columna PRENDA).

**Verificar:** Acabado en el celular, OF con prenda PANTALON de un artículo con base saco + pantalón: solo salen las operaciones de pantalón.

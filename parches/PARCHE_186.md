# Parche 186 — Asistente CHRONOS: avance de una OF por etapa

**Problema:** el avance de una OF se calculaba solo por módulos (última operación de cada uno) y solo en costura. Ruzaad pidió ver corte, costura y acabado, con la operación que pida (penúltima por defecto).

**Cambio:** nueva función de solo lectura `fn_asistente_avance_of(p_dni, p_token, p_of, p_n_op default null)`. Devuelve el corte (pcp_corte) y, por área con base del artículo (sin UDP), las prendas de la operación pedida, la penúltima y la última. No crea tablas ni toca funciones existentes. Mide ~150 ms (no recorre reclamos).

**Verificar:** `select fn_asistente_avance_of('<dni>','<token>','10188');` → SACO COSTURA op 112 = 930 prendas, ACABADO op 14 = 891 (de 1 003).

**Deshacer:** `sql/parche_186_rollback.sql`. Si la función no está, el Asistente vuelve al cálculo anterior.

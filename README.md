[Doc_Git.md](https://github.com/user-attachments/files/30355087/Doc_Git.md)
# SAMITEX — Tickets Virtuales

> Sistema de registro de producción por tickets para líneas de costura.

---

## Índice
1. [El problema que resuelve](#1-el-problema-que-resuelve)
2. [Qué es y cómo funciona](#2-qué-es-y-cómo-funciona)
3. [Roles y vistas](#3-roles-y-vistas)
4. [Cálculo de eficiencia](#4-cálculo-de-eficiencia)
5. [Arquitectura (visión general)](#5-arquitectura-visión-general)
6. [Glosario](#6-glosario)

---

## 1. El problema que resuelve

Antes del sistema, el control de producción dependía enteramente del papel:

- Las boletas de producción del día se entregaban recién en la noche, y se leían al día
  siguiente. El seguimiento del avance real llegaba con **hasta 1½ día de retraso**.
- Los errores de registro no se notaban en el momento, sino mucho después, cuando ya
  era difícil corregir a tiempo.
- El proceso dependía de papel y etiquetas impresas de forma recurrente.

**Tickets Virtuales** digitaliza ese registro para que el avance de producción se vea
**en tiempo real**, por operario, módulo y orden de fabricación (OF), y para que los
errores sean visibles apenas ocurren.

---

## 2. Qué es y cómo funciona

Es una aplicación web (PWA) para que el personal de costura registre su producción
reclamando **tickets** (paquetes de prendas) desde el celular, y para que supervisión
e ingeniería controlen eficiencia, asistencia e incidencias.

**Flujo general:**

1. **Ingeniería** carga la **base de tiempos** (el estándar de minutos por operación
   de cada artículo) y publica el almacén de tickets disponible del día.
2. El **operario** entra con su usuario y clave, elige orden de fabricación → módulo →
   operación → ticket, y lo **reclama** (queda a su nombre y suma minutos producidos).
3. La **supervisora** ve el avance de su área en vivo, registra ocurrencias (máquina
   parada, tardanza, hora extra, permisos…), mueve personal entre áreas si hace falta
   y marca la asistencia.
4. **Ingeniería** consolida todo: eficiencia por persona y por área, tickets del día,
   asistencia mensual, incidencias pendientes y mantenimiento de las bases de tiempos.

Un ticket "vale" `tiempo estándar × cantidad` minutos, y esos minutos son la unidad
con la que se mide el avance y la eficiencia de cada persona y cada área.

---

## 3. Roles y vistas

El sistema redirige a cada persona a su vista según su cargo:

| Rol | Qué hace |
|---|---|
| **Operario** | Reclama los tickets de su área, ve su avance del día y puede solicitar un ajuste de tiempo. |
| **Estajero** | Igual que el operario, pero elige el área de trabajo en cada sesión. |
| **Supervisora** | Controla el avance de su área, registra ocurrencias, mueve personal entre áreas y marca faltantes. |
| **Ingeniería** | Vista transversal: eficiencias, tickets del día, mantenimiento de bases, asistencia e incidencias de toda la planta. |

La vista de ingeniería está pensada para computadora (uso de escritorio), mientras que
operario y supervisora están optimizadas para el celular.

---

## 4. Cálculo de eficiencia

- La jornada considera una base de minutos efectivos de trabajo, descontando el
  tiempo de refrigerio.
- Los minutos disponibles se ajustan por ocurrencias del día (una máquina parada
  los resta; una hora extra los suma).
- Los fines de semana y las ausencias no penalizan la eficiencia del área: si no hay
  jornada, los minutos disponibles de ese día son cero.
- Los minutos producidos son la suma de los tickets reclamados y activos del día en
  el área correspondiente.

**Eficiencia = minutos producidos / minutos disponibles**

---

## 5. Arquitectura (visión general)

| Capa | Rol |
|---|---|
| **Frontend** | Aplicación web (PWA), instalable desde el celular sin pasar por una tienda de aplicaciones. |
| **Backend** | Toda la lógica y los permisos se validan del lado del servidor; el cliente nunca accede directamente a los datos. |
| **Almacén de tickets** | Cada área publica su almacén de tickets disponibles del día, que la app consulta para el reclamo. |
| **Autenticación** | Usuario + clave, con sesión temporal que expira automáticamente por seguridad. |

*(Detalles de configuración, credenciales y esquema de base de datos se documentan
por separado, en un entorno de acceso restringido.)*

---

## 6. Glosario

- **OF**: Orden de Fabricación.
- **Estándar (STD)**: tiempo de referencia, en minutos, que toma una operación por unidad.
- **Ticket / paquete**: unidad reclamable de producción, identificada por un código único.
- **Reclamar**: tomar un ticket a tu nombre, lo que suma minutos producidos.
- **Liberar**: anular un reclamo hecho por error.
- **Eficiencia**: relación entre minutos producidos y minutos disponibles en la jornada.

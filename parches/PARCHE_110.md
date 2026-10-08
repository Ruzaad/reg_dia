# PARCHE 110 — Modo sin señal en el celular del operario

## El problema
En 30 días, 3,438 paquetes se registraron otro día por falta de internet.
Si al tocar SÍ, REGISTRAR se cortaba la señal, el registro se perdía y la
persona tenía que acordarse de hacerlo después, o pedir a Ingeniería que
moviera la fecha.

## El cambio
- Si al registrar no hay señal, los paquetes se guardan en el celular con la
  hora en que se marcaron y salen como "Guardado en tu celular".
- El inicio muestra un aviso ámbar: "N paquetes guardados en tu celular · se
  envían solos". Hay un botón "Enviar ahora".
- Al volver la señal se mandan solos, al reconectar, al volver a la app o
  cada 45 s. Después el aviso dice cuántos entraron y cuáles no porque otra
  persona ya los tenía.
- Lo marcado ayer queda con fecha de ayer y motivo FALTA DE INTERNET, el
  mismo que ya usa Ingeniería al mover fechas. Lo de hace más de un día no se
  manda: se avisa que lo registre Ingeniería.
- No aplica a ACABADO, que registra por cantidad. El service worker no cambia.

## Base (`sql/parche_110.sql`)
Nueva `fn_reclamar_lote_hora(p_dni, p_token, p_area, p_tickets, p_marcado)`.
Usa `fn_reclamar_lote`, sin cambiarla, y solo mueve a ayer lo que insertó en
esa misma llamada.
Sin el parche, lo de hoy se manda con `fn_reclamar_lote`.
Rollback: `drop function public.fn_reclamar_lote_hora(text, uuid, text, jsonb, timestamptz);`

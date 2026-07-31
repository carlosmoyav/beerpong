# 🍺 Torneo Beer Pong — versión web multi-sala

App web para administrar torneos de Beer Pong en tiempo real. Cada torneo es
una **sala con su propio código**: la computadora conectada al proyector muestra
las llaves y el partido en juego, y desde el **celular** controlas todo. Varias
fiestas pueden usar la app a la vez **sin mezclarse**.

Incluye: llaves automáticas con byes, registro de vasos con rack (re-arma la
formación: triángulo, columna...), animación pop-up al anotar, temporizador con
cuenta regresiva, estadísticas (copas, % de acierto, MVP, rachas), jugadores
tardíos, deshacer, y exportación a CSV.

---

## Cómo funciona (para que no se mezclen las salas)

- Al **crear un torneo** (nombre + PIN) se genera un **código** único, ej. `K7QP`.
- Enlaces de esa sala:
  - Proyector (solo lectura): `tudominio.com/p/K7QP`
  - Panel (pide PIN): `tudominio.com/admin/K7QP`
- El **QR sale distinto en cada torneo** solo, porque lleva el código adentro.
- En tiempo real, cada sala usa su propio **canal** (Socket.IO rooms): un cambio
  en `K7QP` **nunca** llega a las pantallas de otro torneo.
- El **PIN es por sala**, se guarda **hasheado** (nunca en texto claro) y tiene
  límite de intentos para que nadie lo adivine.

---

## Requisitos

- **Node.js 18 o mayor** (`node -v` para comprobar; si no, instálalo de nodejs.org).
- Para la web: una base **Postgres** gratis en **Neon** (neon.tech) y una cuenta
  en **Render** (render.com). En local no hace falta base de datos.

---

## Correr en tu computadora (local)

```bash
npm install
npm start
```

Abre `http://localhost:3000`, crea un torneo y comparte el código/QR.
Sin `DATABASE_URL`, guarda en archivos dentro de `data/` (perfecto para probar).

> Para que otros entren desde el celular en tu misma red Wi-Fi, usa la dirección
> "Red" que muestra la terminal (ej. `http://192.168.0.15:3000`).

---

## Subirlo a la web (Neon + Render)

**Importante:** esta app necesita un servidor **siempre encendido** (por las
conexiones en vivo), así que **no va en Vercel**. Va en Render (o Railway/Fly).

### 1) Base de datos en Neon (gratis)

1. Entra a **neon.tech**, crea un proyecto.
2. Copia la **connection string** (empieza con `postgres://...` y termina en
   `?sslmode=require`).
3. La tabla se crea sola la primera vez que arranca la app.

### 2) Desplegar en Render

1. Sube este proyecto a un repo de **GitHub**.
2. En **render.com** → **New** → **Web Service** → conecta ese repo.
3. Render detecta `render.yaml`. Si te pide comandos: Build `npm install`,
   Start `npm start`.
4. En **Environment**, agrega la variable:
   - `DATABASE_URL` = la cadena de conexión de Neon.
   - (Opcional) `ROOM_TTL_DAYS` = `7` (días que se guarda un torneo inactivo).
5. Deploy. Al terminar tendrás una URL pública tipo
   `https://beerpong-tournament.onrender.com`.

> **Plan gratis de Render:** el servicio se **duerme** tras ~15 min de inactividad
> y tarda ~30 s en despertar (feo en plena fiesta). El plan *Starter* (~$7/mes)
> lo mantiene despierto. Con Postgres, aunque se reinicie, **no se pierden** los
> torneos.

---

## Variables de entorno

| Variable        | Para qué sirve                                             |
|-----------------|-----------------------------------------------------------|
| `DATABASE_URL`  | Postgres (Neon). Si falta, usa archivos (solo local).     |
| `PORT`          | Puerto. Render lo asigna solo; en local 3000.             |
| `ROOM_TTL_DAYS` | Días antes de borrar un torneo inactivo (por defecto 7).  |
| `PGSSL`         | Ponlo en `off` solo si tu Postgres no usa SSL (Neon sí).  |

Ver `.env.example`.

---

## Estructura

```
server/
  index.js        Servidor: páginas, API, WebSockets, salas, PIN, limpieza
  store.js        Elige el driver (Postgres si hay DATABASE_URL; si no, archivos)
  store-pg.js     Guardado en Postgres
  store-file.js   Guardado en archivos (local)
  auth.js         Hasheo y verificación del PIN (scrypt)
  tournament.js   Motor del torneo (llaves, vasos, temporizador, stats...)
  bracket.js      Siembra y nombres de ronda
public/
  home.html       Inicio: crear torneo / entrar por código
  projector.html  Pantalla del proyector (por sala)
  admin.html      Panel del celular (por sala)
  js/, css/       Lógica y estilos
```

## Cómo se usa (resumen)

1. En la computadora del proyector, abre la web y **crea el torneo** (nombre + PIN).
2. Te lleva a la pantalla del proyector. Toca **"QR panel"** y **escanéalo** con
   tu celular (o entra a `/admin/CODIGO`).
3. En el celular ingresa el PIN (queda recordado en ese teléfono).
4. Agrega jugadores, inicia, y marca vasos/ganadores. Todo se ve en vivo en el
   proyector.

## Notas

- Está pensada para **una instancia** de servidor (el working set vive en memoria
  y se respalda en Postgres). El plan free de Render corre una sola instancia.
- Los torneos inactivos se borran solos según `ROOM_TTL_DAYS` para no acumular.

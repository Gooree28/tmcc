# TMC · Captura de leads

Backend Express + SQLite para la landing de diagnóstico de Tendencia Marketing.

## Desarrollo local

```bash
npm install
cp .env.example .env
npm start
```

La aplicación queda disponible en `http://localhost:3000`.

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---:|---|
| `PORT` | No | Puerto HTTP; por defecto `3000`. |
| `DATABASE_FILE` | No | Ruta de SQLite; por defecto `data/leads.db`. En producción debe estar dentro de un volumen persistente. |
| `IP_HASH_SECRET` | Sí en producción | Secreto para generar hashes de IP; no usar el valor de desarrollo. |

## Pruebas

```bash
curl http://localhost:3000/health
curl -i -X POST http://localhost:3000/api/leads \
  -H 'Content-Type: application/json' \
  -d '{"nombre":"Prueba","whatsapp":"526181234567","email":"test@example.com"}'
```

El servidor valida de nuevo los campos, aplica un honeypot, limita solicitudes y almacena los leads mediante consultas parametrizadas. Las IP no se almacenan en texto plano: se guarda un hash HMAC con el secreto configurado.

## Despliegue

Usa un proveedor con volumen persistente para SQLite. Configura `DATABASE_FILE` apuntando al volumen, `IP_HASH_SECRET` con un secreto aleatorio y HTTPS en el dominio. No ejecutes varias réplicas con el mismo archivo SQLite.

## Backup y restauración

Antes de copiar la base, usa una copia consistente de SQLite (`VACUUM INTO` o la API de backup de SQLite), cifra el archivo y súbelo a un bucket privado S3-compatible. No subas datos de leads a GitHub. Para restaurar, detén la aplicación, reemplaza el archivo del volumen por una copia descifrada y verifica:

```bash
sqlite3 "$DATABASE_FILE" 'PRAGMA integrity_check;'
```

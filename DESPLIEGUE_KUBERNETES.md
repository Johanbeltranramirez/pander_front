# Despliegue de Pander en Kubernetes (K3s + Oracle Cloud)

Documento paso a paso para desplegar Pander (backend Django + frontend React) en un servidor
Oracle Cloud con K3s, siguiendo la *Guía Completa de Despliegue Pander Kubernetes*.
Cada comando trae su explicación para que se entienda qué se hace y por qué.

> **Convención:** los comandos marcados como **[PC]** se ejecutan en tu computador y los marcados
> como **[SERVIDOR]** se ejecutan por SSH dentro de la máquina virtual de Oracle.

---

## 1. Cómo queda armado todo

```
Internet ──► pander.duckdns.org ──► Oracle VM (Ampere A1, ARM64)
                                      └─ K3s
                                         └─ Traefik (Ingress, puertos 80/443, HTTPS con Let's Encrypt)
                                            ├─ /api, /admin, /static ─► backend  (Django + Gunicorn, 1–2 pods)
                                            └─ /  y  /media          ─► frontend (NGINX, 2 pods)
                                         backend ──► postgres (StatefulSet, disco de 20 Gi)
                                         backend y frontend comparten el disco "pander-media" (5 Gi)
```

- El frontend y la API usan **el mismo dominio**, así que no hay problemas de CORS y el frontend
  llama a `/api/...` sin poner una URL completa.
- Las imágenes se construyen en GitHub Actions, se suben a **GHCR** (`ghcr.io`) y el servidor las descarga.
- En cada `push` a `main` el workflow construye la imagen y la despliega por SSH.

### Repositorios y archivos nuevos

La guía original asume **un solo repositorio**; el proyecto tiene **dos**, así que cada uno quedó con lo suyo:

| Repositorio | Archivo | Para qué sirve |
|---|---|---|
| `pander_back` | `Dockerfile`, `.dockerignore` | Construye la imagen del backend (Python 3.12, Gunicorn, WhiteNoise) |
| `pander_back` | `config/health.py` + ruta `api/health/` | Endpoint que usan las *probes* de Kubernetes |
| `pander_back` | `config/settings.py` | Ahora lee todo de variables de entorno (clave, base de datos, correo, hosts, CORS…) |
| `pander_back` | `requirements.txt` | Se agregó `gunicorn` y `whitenoise`; se quitaron `psycopg`/`psycopg2` (queda `psycopg2-binary`). Se pasó el archivo de UTF-16 a UTF-8 |
| `pander_back` | `kubernetes/*.yaml` | Namespace, ConfigMap, Postgres, volumen de media, migraciones, backend, HPA e Ingress |
| `pander_back` | `kubernetes/infra/*.yaml` | Se aplican una sola vez a mano: ClusterIssuer de Let's Encrypt y tiempos de Traefik |
| `pander_back` | `.github/workflows/deploy.yml` | Construye, sube la imagen y despliega el backend |
| `pander_back` | `.env.example`, `docker-compose.yml` | Para probar en local antes de subir |
| `pander_back` | `apps/empresa/migrations/0002_datos_iniciales.py` | La contraseña del usuario `admin` inicial ahora puede venir de `PANDER_ADMIN_PASSWORD` |
| `pander_front` | `Dockerfile`, `nginx.conf`, `.dockerignore` | Compila con Node y sirve con NGINX (también sirve `/media`) |
| `pander_front` | `src/api/axios.js` | `baseURL` sale de `VITE_API_URL` (vacío en producción) |
| `pander_front` | `GestionCandidatos.jsx` | El enlace a los anexos ya no tiene `http://localhost:8000` fijo |
| `pander_front` | `package.json` | Se fijó `packageManager: pnpm@10.28.0` (el Dockerfile usa pnpm y `pnpm-lock.yaml`) |
| `pander_front` | `kubernetes/05-frontend.yaml` | Deployment (2 réplicas) y Service del frontend |
| `pander_front` | `.github/workflows/deploy.yml` | Construye, sube y despliega el frontend |

**Orden importante:** siempre se despliega primero el backend (crea el namespace y el disco `pander-media`)
y después el frontend.

---

## 2. Antes de empezar: seguridad (leer primero)

Revisando los repositorios aparecieron cosas que **hay que corregir antes de publicar**, porque los repos son públicos:

1. **La contraseña de aplicación de Gmail estaba escrita en `settings.py`** y queda en el historial de Git.
   Entra a tu cuenta de Google → Seguridad → Contraseñas de aplicación y **revócala**; luego crea una nueva
   y úsala solo en el Secret de Kubernetes (paso 8).
2. La contraseña de Postgres que estaba en el código (`Admin1234*`) también se considera expuesta; en el servidor
   usa una nueva (paso 8).
3. La migración `0002_datos_iniciales.py` crea el usuario `admin` con la clave `Admin1234*`. Define
   `PANDER_ADMIN_PASSWORD` en el Secret **antes** del primer despliegue para que nazca con otra clave.
   Si ya se desplegó con la clave por defecto, cámbiala desde la aplicación apenas ingreses.
4. La carpeta `media/` está subida a Git y trae **hojas de vida reales** (datos personales), y hay 86 archivos
   `__pycache__` versionados. Para dejar de rastrearlos (el `.gitignore` ya los ignora):
   ```bash
   git rm -r --cached media
   git ls-files | grep __pycache__ | xargs git rm --cached
   git commit -m "Dejar de versionar media y pycache"
   ```
   Esto no borra el historial anterior; si los CV son reales, evalúa limpiar el historial (`git filter-repo`).
5. `/media/` queda **público**: cualquiera con la URL exacta de un archivo puede abrirlo. Los nombres son aleatorios
   (UUID), lo que ayuda, pero no es autenticación.
6. Es un solo nodo: si la máquina cae, la aplicación cae (no hay alta disponibilidad). Y los datos viven en
   discos locales del nodo, así que hay que hacer copias (sección 12).
7. El README del frontend tiene marcas de conflicto de merge (`<<<<<<<`); conviene arreglarlo.

---

## 3. Probar la imagen en local (opcional, recomendado)

**[PC]** Con Docker instalado, en la carpeta de `pander_back`:

```bash
docker compose up --build
```
- Construye la imagen del backend, levanta un Postgres 16 y corre `migrate`.
- Cuando termine, abre `http://localhost:8000/api/health/`; debe responder `{"status": "ok"}`.
- Para apagar: `docker compose down` (agrega `-v` si quieres borrar también la base de datos de prueba).

> En un computador con procesador Intel/AMD tarda un poco más, pero funciona igual: la imagen de Python es multi-arquitectura.

---

## 4. Servidor en Oracle Cloud

1. Crea una instancia **VM.Standard.A1.Flex** (Ampere, ARM64) con **Ubuntu 22.04 o 24.04**. Con el plan gratis
   puedes usar hasta 4 OCPU y 24 GB de RAM; para Pander son recomendables **2 OCPU y 12 GB** o más
   (PyTorch y EasyOCR consumen memoria).
2. Descarga la llave SSH que te da Oracle y guárdala (por ejemplo `oracle.key`).
3. En la consola de Oracle: *Networking → Virtual Cloud Networks → tu VCN → Security Lists* y agrega reglas de
   **entrada** (Ingress) desde `0.0.0.0/0` para TCP **22, 80 y 443**.

**[PC]** Conectarse:
```bash
chmod 600 oracle.key                  # SSH exige que la llave no sea legible por otros
ssh -i oracle.key ubuntu@IP_PUBLICA   # usuario "ubuntu" en las imágenes de Ubuntu
```

**[SERVIDOR]** Las imágenes de Oracle traen reglas de `iptables` que bloquean los puertos aunque la Security List los permita:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT   # abre HTTP
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT   # abre HTTPS
sudo apt-get update && sudo apt-get install -y iptables-persistent            # para que sobrevivan al reinicio (acepta guardar)
sudo netfilter-persistent save
```
Si ya había reglas distintas, revisa con `sudo iptables -L INPUT -n --line-numbers` que el `ACCEPT` quede antes de un `REJECT`.

---

## 5. Dominio con DuckDNS

1. Entra a <https://www.duckdns.org>, inicia sesión y crea el subdominio **`pander`** (queda `pander.duckdns.org`).
2. En el campo *current ip* pon la IP pública de la VM y pulsa *update ip*.
3. **[PC]** Verifica que apunta bien (debe mostrar tu IP):
   ```bash
   nslookup pander.duckdns.org
   ```
Let's Encrypt necesita que este dominio ya resuelva a tu servidor, o el certificado no se emitirá.
Si usas otro dominio, cámbialo en `kubernetes/01-configmap.yaml`, `kubernetes/04-backend.yaml` (header `Host` de las probes)
y `kubernetes/06-ingress.yaml`.

---

## 6. Instalar K3s

**[SERVIDOR]**
```bash
curl -sfL https://get.k3s.io | sh -
```
Descarga e instala K3s (Kubernetes liviano). Ya incluye **Traefik** (Ingress), **local-path** (discos) y
**metrics-server** (lo usa el HPA). Se instala como servicio.

```bash
sudo k3s kubectl get nodes
```
Debe mostrar un nodo en estado `Ready` (puede tardar un minuto). Para no escribir `sudo k3s kubectl` todo el tiempo:
```bash
echo "alias k='sudo k3s kubectl'" >> ~/.bashrc && source ~/.bashrc
```
En el resto del documento se usa `k` como atajo de `sudo k3s kubectl`.

```bash
k get pods -A
```
Lista todos los pods del clúster; los de `kube-system` (coredns, traefik, metrics-server…) deben estar `Running`.

---

## 7. Instalar cert-manager y el emisor de certificados

cert-manager pide y renueva automáticamente los certificados HTTPS de Let's Encrypt.

**[SERVIDOR]**
```bash
k apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.2/cert-manager.yaml
```
Instala cert-manager en el namespace `cert-manager`. (`v1.16.2` es la versión usada al escribir la guía; puedes
revisar si hay una más nueva en <https://github.com/cert-manager/cert-manager/releases>.)

```bash
k -n cert-manager get pods
```
Espera a que los 3 pods (`cert-manager`, `cainjector`, `webhook`) estén `Running` y `1/1`.

Ahora el ClusterIssuer. Copia el archivo al servidor, edita **tu correo** y aplícalo. **[PC]**:
```bash
scp -i oracle.key kubernetes/infra/*.yaml ubuntu@IP_PUBLICA:~/
```
**[SERVIDOR]**
```bash
nano ~/cluster-issuer.yaml          # cambia CAMBIA_ESTO@tu-correo.com por tu correo real (Let's Encrypt avisa ahí si un certificado va a vencer)
k apply -f ~/cluster-issuer.yaml
k get clusterissuer                 # letsencrypt-prod debe aparecer con READY = True
```

**(Opcional pero recomendado) Tiempos largos para la importación masiva de CV.** Traefik corta por defecto las
peticiones lentas (~60 s); subir muchos archivos y leerlos con el modelo puede tardar más:
```bash
k apply -f ~/traefik-timeouts.yaml
```
K3s reinicia Traefik automáticamente (tarda un par de minutos). No cambia nada más.

---

## 8. Crear namespace y Secret (una sola vez)

El Secret guarda claves y **nunca** se sube a Git, por eso se crea a mano.

**[SERVIDOR]**
```bash
k create namespace pander
```
Crea el espacio de nombres donde vive todo Pander.

Genera valores y guárdalos en variables. `read -s` no muestra lo que escribes ni lo deja en el historial:
```bash
DJANGO_SECRET_KEY=$(openssl rand -base64 64 | tr -d '\n')     # clave secreta de Django (aleatoria)
read -s -p "Contraseña NUEVA para Postgres: " DB_PASSWORD; echo
read -s -p "Contraseña inicial del usuario admin de Pander: " ADMIN_PASSWORD; echo
read -p  "Correo SMTP (Gmail): " EMAIL_USER
read -s -p "Contraseña de aplicación de Gmail (la NUEVA): " EMAIL_PASS; echo
```

Crea el Secret con esos valores:
```bash
k -n pander create secret generic pander-secrets \
  --from-literal=DJANGO_SECRET_KEY="$DJANGO_SECRET_KEY" \
  --from-literal=DB_PASSWORD="$DB_PASSWORD" \
  --from-literal=PANDER_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
  --from-literal=EMAIL_HOST_USER="$EMAIL_USER" \
  --from-literal=EMAIL_HOST_PASSWORD="$EMAIL_PASS"
unset DJANGO_SECRET_KEY DB_PASSWORD ADMIN_PASSWORD EMAIL_USER EMAIL_PASS   # borra las variables de la sesión
```
Comprueba que existe (no muestra los valores): `k -n pander get secret pander-secrets`.

> `DB_PASSWORD` la usan tanto Postgres (para crear el usuario `pander`) como Django (para conectarse).
> Ojo: Postgres solo la lee la **primera vez** que crea la base; si después la cambias hay que cambiarla también dentro de Postgres.

---

## 9. Configurar GitHub

### 9.1 Llave SSH para que GitHub Actions entre al servidor
**[PC]**
```bash
ssh-keygen -t ed25519 -f deploy_key -C "github-actions-pander" -N ""
```
Crea `deploy_key` (privada) y `deploy_key.pub` (pública), sin contraseña para que el workflow pueda usarla.

```bash
ssh-copy-id -i deploy_key.pub -o "IdentityFile=oracle.key" ubuntu@IP_PUBLICA
```
Agrega la llave pública a `~/.ssh/authorized_keys` del servidor. (Si falla, copia el contenido de `deploy_key.pub`
y pégalo en una línea nueva de ese archivo.)

Prueba que entra: `ssh -i deploy_key ubuntu@IP_PUBLICA "sudo k3s kubectl get nodes"` debe mostrar el nodo (el usuario `ubuntu` puede usar `sudo` sin contraseña en las imágenes de Oracle).

### 9.2 Secrets de los repositorios
En **cada** repositorio (`pander_back` y `pander_front`): *Settings → Secrets and variables → Actions → New repository secret*:

| Nombre | Valor |
|---|---|
| `SSH_HOST` | IP pública del servidor |
| `SSH_USER` | `ubuntu` |
| `SSH_PRIVATE_KEY` | Contenido **completo** de `deploy_key` (incluye las líneas `BEGIN/END`) |

Luego **borra `deploy_key`** de tu computador si no la necesitas más: ya vive en GitHub.

### 9.3 Permisos de Actions
*Settings → Actions → General → Workflow permissions*: deja **Read and write permissions** (para publicar en GHCR con el `GITHUB_TOKEN`).

### 9.4 Imágenes en GHCR
Después del primer despliegue, en GitHub → tu perfil → *Packages* → `pander-back` y `pander-front` → *Package settings* →
**Change visibility → Public**. Así el servidor descarga las imágenes sin credenciales.
Si prefieres mantenerlas privadas, crea un token (PAT) con permiso `read:packages` y, **[SERVIDOR]**:
```bash
k -n pander create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=Johanbeltranramirez --docker-password=TU_TOKEN
```
Los manifiestos ya referencian `ghcr-pull` como `imagePullSecrets` (si no existe, simplemente se intenta sin credenciales).

---

## 10. Desplegar

1. Sube a `main` los cambios del **backend** (`git add . && git commit -m "Despliegue en Kubernetes" && git push origin main`).
   - Mira la pestaña **Actions**. El job `build` construye la imagen ARM64 (la primera vez tarda ~15–25 min por PyTorch).
   - El job `deploy` copia los manifiestos y, en el servidor, hace en orden: crear namespace → ConfigMap, disco de media y Postgres →
     esperar a Postgres → correr el Job de migraciones → aplicar backend, HPA e Ingress → esperar a que el backend esté listo.
2. Cuando termine en verde, sube a `main` los cambios del **frontend**. Compila con Vite, construye la imagen NGINX y la despliega.
3. Pon públicos los paquetes (9.4) si aún no lo hiciste y, si algún pod quedó en `ImagePullBackOff`, reinicia: `k -n pander rollout restart deployment/backend deployment/frontend`.

También puedes lanzar cualquiera de los workflows a mano desde *Actions → Desplegar … → Run workflow*.

---

## 11. Verificar que funciona

**[SERVIDOR]**
```bash
k -n pander get pods
```
Deben estar `Running`: `postgres-0`, `backend-…` y dos `frontend-…`. El Job `pander-migrate` debe verse `Completed`.

```bash
k -n pander get certificate
```
`pander-tls` debe pasar a `READY = True` (1–3 minutos después del primer despliegue). Si no pasa, mira la sección 14.

```bash
k -n pander logs deployment/backend --tail=50     # logs del backend
k -n pander get hpa                                # estado del autoescalado (1–2 pods)
k -n pander get pvc                                # discos: pander-media y pgdata-postgres-0 en estado Bound
```

**[PC]**
```bash
curl -i https://pander.duckdns.org/api/health/?db=1   # {"status": "ok", "db": true}
curl -I http://pander.duckdns.org                      # 301 hacia https://
```
Y en el navegador: `https://pander.duckdns.org` (la aplicación), `https://pander.duckdns.org/admin/` (admin de Django, con estilos).
Entra con el usuario `admin` y la contraseña que pusiste en `PANDER_ADMIN_PASSWORD`, y prueba la **Importación masiva** subiendo un CV.

Cuando HTTPS esté estable, puedes activar HSTS cambiando `DJANGO_HSTS_SECONDS` a `"31536000"` en `kubernetes/01-configmap.yaml` y haciendo push.

---

## 12. Operación del día a día

| Qué quiero | Comando **[SERVIDOR]** | Explicación |
|---|---|---|
| Ver todo | `k -n pander get all` | Pods, servicios, deployments |
| Logs en vivo | `k -n pander logs -f deployment/backend` | `-f` sigue los logs |
| Reiniciar backend | `k -n pander rollout restart deployment/backend` | Reinicio sin cortar el servicio |
| Volver a la versión anterior | `k -n pander rollout undo deployment/backend` | Rollback de la última actualización |
| Consola de Django | `k -n pander exec -it deployment/backend -- python manage.py shell` | Entra al contenedor |
| Cambiar configuración | edita `01-configmap.yaml`, haz push y luego `k -n pander rollout restart deployment/backend` | Los pods leen el ConfigMap solo al arrancar |
| Cambiar un secreto | borra y crea el Secret (paso 8) y reinicia backend | |

**Copia de seguridad de la base de datos** (hazla antes de cada cambio grande):
```bash
k -n pander exec postgres-0 -- sh -c 'pg_dump -U pander pander_db' > pander_$(date +%F).sql
```
Ejecuta `pg_dump` dentro del pod y guarda el resultado en un archivo del servidor. Para restaurar:
`k -n pander exec -i postgres-0 -- psql -U pander pander_db < pander_FECHA.sql`.

**Copia de los archivos subidos** (CV):
```bash
k -n pander exec deployment/backend -- tar czf - -C /app media > media_$(date +%F).tgz
```

Descarga las copias a tu PC (`scp`), porque en el mismo servidor no sirven si se pierde.

---

## 13. Cómo funciona cada pieza (para sustentar)

- **ConfigMap vs Secret:** el ConfigMap guarda configuración que no es sensible (dominio, host de la base); el Secret guarda claves. Ambos entran al contenedor como variables de entorno (`envFrom`).
- **StatefulSet de Postgres:** mantiene el mismo nombre (`postgres-0`) y el mismo disco aunque el pod se reinicie.
- **Job de migraciones:** corre `python manage.py migrate` una vez por despliegue, antes de que arranque la nueva versión del backend, para evitar que varios pods migren a la vez.
- **Probes:** `startupProbe` espera la carga lenta de PyTorch; `readinessProbe` (con `?db=1`) saca al pod del tráfico si la base no responde; `livenessProbe` lo reinicia si se cuelga. Llevan el header `Host` porque Django rechaza peticiones con la IP del pod.
- **HPA:** si el CPU promedio pasa del 70 %, sube de 1 a 2 pods del backend.
- **WhiteNoise:** Gunicorn sirve los archivos estáticos del admin, así no hace falta otro servidor para `/static`.
- **Media:** Django solo sirve `/media` con `DEBUG=True`, por eso NGINX lo lee del disco compartido `pander-media` (montado solo-lectura en el frontend).
- **Ingress + cert-manager:** Traefik recibe el tráfico, redirige HTTP a HTTPS y reparte rutas; cert-manager obtiene el certificado por el desafío HTTP-01.
- **Runner ARM:** el servidor es ARM64; construir con un runner ARM nativo evita emular con QEMU, que haría el build de PyTorch muy lento.

---

## 14. Problemas frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| Certificado no pasa a `READY` | El dominio no apunta a la IP, o el puerto 80 está cerrado | `nslookup pander.duckdns.org`; revisa Security List e iptables (paso 4); `k -n pander describe certificate pander-tls` y `k -n pander get challenges` |
| `ImagePullBackOff` | Paquete GHCR privado o nombre mal escrito | Hazlo público (9.4) o crea `ghcr-pull`; revisa `k -n pander describe pod <pod>` |
| `CrashLoopBackOff` en backend | Falta el Secret o variable | `k -n pander logs deployment/backend`; el error `Falta la variable de entorno DJANGO_SECRET_KEY` indica el Secret |
| Error 400 *Bad Request* | Dominio no está en `DJANGO_ALLOWED_HOSTS` | Corrígelo en el ConfigMap y reinicia el backend |
| Login/POST da 403 *CSRF* | Falta el dominio en `CSRF_TRUSTED_ORIGINS` | Igual que arriba |
| 504 / se corta al importar muchos CV | Tiempo límite de Traefik | Aplica `traefik-timeouts.yaml` (paso 7) y sube pocos archivos por tanda |
| Admin sin estilos | `collectstatic` o ruta `/static` | Comprueba que el Ingress tenga `/static` → backend |
| Pod `Pending` | Falta memoria/CPU o disco sin crear | `k -n pander describe pod <pod>`; `k get pvc -A` |
| El workflow falla en `get secret pander-secrets` | No se creó el Secret | Paso 8 |
| El Job de migraciones falla | Postgres no listo o clave de DB distinta | `k -n pander logs job/pander-migrate` |

---

## 15. Desinstalar todo

```bash
k delete namespace pander        # borra la aplicación Y sus discos (la base de datos se pierde)
/usr/local/bin/k3s-uninstall.sh  # quita K3s del servidor
```

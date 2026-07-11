# Deploy Guide — CineMatch backend

Target: **MongoDB Atlas (free M0)** + **AWS EC2 (free t2/t3.micro)** + **Nginx + Let's Encrypt HTTPS**
at `https://cinematch.adityadevhub.in`, with **auto-deploy on merge to `main`** via GitHub Actions.

Do the steps in order. Anything in `<angle brackets>` is a value you substitute.

---

## 1. MongoDB Atlas (free tier)

1. Sign up / log in at <https://cloud.mongodb.com>.
2. **Create a project** → name it `cinematch`.
3. **Build a Database** → **M0 (Free)** → pick a region near your EC2 region → Create.
4. **Database Access** → *Add New Database User* → username `cinematch`, generate a strong password (save it). Role: *Read and write to any database*.
5. **Network Access** → *Add IP Address*. For now add `0.0.0.0/0` (allow all) to get running, then **tighten to your EC2 public IP** once the instance exists (step 2.2). ⚠️ Leaving it open is a security risk — restrict it.
6. **Connect** → *Drivers* → copy the SRV string:
   `mongodb+srv://cinematch:<password>@cluster0.xxxx.mongodb.net/cinematch?retryWrites=true&w=majority`
   This becomes `MONGODB_URI` in the backend `.env` (step 2.5).

---

## 2. AWS EC2 (free tier)

### 2.1 Launch the instance
1. EC2 console → **Launch instance**.
2. Name `cinematch`. AMI: **Amazon Linux 2023**. Type: **t2.micro** or **t3.micro** (free-tier eligible).
3. **Key pair** → create one (`cinematch-key`), download the `.pem`. Keep it safe (`chmod 400`).
4. **Network settings** → security group inbound rules (least privilege):
   - SSH `22` — source **My IP** only.
   - HTTP `80` — `0.0.0.0/0` (certbot + redirect).
   - HTTPS `443` — `0.0.0.0/0`.
   - Do **not** open `3000` — Nginx fronts it; Node only listens on localhost.
5. Launch. Note the **public IPv4** and, if you want it stable across reboots, allocate an **Elastic IP** and associate it.

### 2.2 Lock Atlas to this IP
Back in Atlas → Network Access → replace `0.0.0.0/0` with the EC2 public IP.

### 2.3 SSH in + install runtime
```bash
ssh -i cinematch-key.pem ec2-user@<EC2_PUBLIC_IP>

# Node 20
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo yum install -y nodejs git nginx
sudo npm install -g pm2

# clone into ~/cinematch — for a private repo add a deploy key first
git clone https://github.com/adityaamaiya/cinematch.git ~/cinematch
```

### 2.4 Build + configure the backend
```bash
cd ~/cinematch/backend
npm ci
cp .env.example .env
nano .env        # fill TMDB tokens, MONGODB_URI (Atlas), a long random SYNC_TOKEN, PORT=3000
npm run build
```

### 2.5 Start under pm2 (survives reboots)
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup        # run the sudo command it prints, then `pm2 save` again
curl localhost:3000/health   # {"success":true,...}
```

---

## 3. DNS (BigRock) + Nginx + HTTPS

### 3.1 Point the subdomain at EC2
In BigRock DNS management for `adityadevhub.in`, add an **A record**:
`cinematch` → `<EC2_PUBLIC_IP>` (TTL default). Wait for it to resolve: `dig +short cinematch.adityadevhub.in`.

### 3.2 Nginx reverse proxy
```bash
sudo cp ~/cinematch/deploy/nginx.conf /etc/nginx/conf.d/cinematch.conf
sudo nginx -t && sudo systemctl enable --now nginx
```
Check `http://cinematch.adityadevhub.in/health` returns JSON.

### 3.3 Let's Encrypt TLS (certbot)
```bash
sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d cinematch.adityadevhub.in    # follow prompts; choose to redirect HTTP→HTTPS
```
certbot edits the Nginx config to add the 443 block + auto-renew timer. Verify:
`curl https://cinematch.adityadevhub.in/health`.

---

## 4. Auto-deploy on merge (GitHub Actions)

Workflow: `.github/workflows/deploy.yml` (runs tests on every push/PR; on push to `main`, SSHes in and redeploys).

Add repo **Secrets** (Settings → Secrets and variables → Actions):
- `EC2_HOST` — EC2 public IP (or `cinematch.adityadevhub.in`).
- `EC2_USER` — `ec2-user`.
- `EC2_SSH_KEY` — contents of a private key whose public key is in `~/.ssh/authorized_keys` on EC2.
  (Generate a dedicated deploy key: `ssh-keygen -t ed25519 -f deploy_key`, append `deploy_key.pub` to the server's `authorized_keys`, paste `deploy_key` here.)

After this, merging to `main` runs tests → SSH → `git pull && npm ci && npm run build && pm2 reload`.

---

## 5. Point the extension at prod
In `extension/popup.js` set `DEFAULT_BACKEND` to `https://cinematch.adityadevhub.in` (host permission is already
in `manifest.json`), reload the unpacked extension.

## 6. Seed / sync your profile
- No Moctale: `cd backend && npm run seed` (uses `profile.example.json`), or seed your own JSON.
- With Moctale: run the scraper locally (`cd scraper && npx playwright install chromium && npm run scrape`),
  with `BACKEND_URL=https://cinematch.adityadevhub.in` and the matching `SYNC_TOKEN` in `scraper/.env`.

## Security checklist
- [ ] Atlas Network Access restricted to the EC2 IP (not `0.0.0.0/0`).
- [ ] Security group: 22 from your IP only; 3000 never exposed.
- [ ] Strong random `SYNC_TOKEN`, identical in backend and scraper `.env`.
- [ ] `.env` never committed; secrets only in GitHub Actions secrets + the server `.env`.
- [ ] HTTPS enforced (certbot redirect enabled).

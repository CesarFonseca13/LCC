# Deploy do ClinicaOS na VPS

Guia completo para colocar o sistema em produção numa VPS Ubuntu 24.04
(testado no plano de 1 VPS única com Docker Compose). Tempo total: ~30 min.

## 0. O que você precisa em mãos

- IP da VPS + acesso SSH (root ou usuário com sudo)
- Opcional: um domínio próprio (ex.: `app.suaclinica.com.br`) apontando
  para o IP. **Sem domínio**, o sistema funciona com `sslip.io`
  (ex.: `169-58-242-252.sslip.io`) com HTTPS de verdade — dá para trocar
  pelo domínio real depois sem perder nada.

## 1. Preparar a VPS (uma vez)

```bash
ssh root@SEU_IP

# Docker oficial + compose plugin
curl -fsSL https://get.docker.com | sh

# Firewall: só SSH e web
apt-get install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable

# Swap de segurança (protege contra picos de build/memória)
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Levar o código para a VPS

Na SUA máquina (o repositório é privado — empacota e envia):

```bash
cd clinicaos
git archive --format=tar.gz -o /tmp/clinicaos.tar.gz HEAD
scp /tmp/clinicaos.tar.gz root@SEU_IP:/opt/
```

Na VPS:

```bash
mkdir -p /opt/clinicaos && tar -xzf /opt/clinicaos.tar.gz -C /opt/clinicaos
cd /opt/clinicaos
```

## 3. Configurar o ambiente

```bash
cp infra/.env.production.example infra/.env
nano infra/.env
```

Preencha TUDO. Gere cada segredo com `openssl rand -base64 32`:

- `APP_DOMAIN` / `APP_URL` — domínio real ou `SEU-IP-com-tracos.sslip.io`
- 4 senhas de banco (todas diferentes)
- `SENSITIVE_DATA_KEY` — **guarde uma cópia fora da VPS**; perder = perder
  anamneses e chaves de IA cifradas
- `EVOLUTION_API_KEY` — segredo interno do WhatsApp
- IA: `ANTHROPIC_API_KEY` (ou provedor OpenAI-compatível)
- `SEED_*` — nome da clínica real, e-mail e senha FORTE da dona

## 4. Subir

```bash
bash infra/deploy.sh seed     # primeira vez (cria a conta da clínica)
```

Nas atualizações futuras: reenvie o tar.gz (passo 2) e rode
`bash infra/deploy.sh` (sem `seed`).

A Evolution API demora alguns minutos no primeiro boot (migrações Prisma).
Acompanhe com `docker compose -f infra/docker-compose.yml logs -f evolution`.

## 5. Checklist pós-subida

1. `https://APP_DOMAIN` abre a landing ✔
2. Login com o SEED_OWNER_EMAIL/senha ✔ → wizard de implantação
3. Configurações → conectar o WhatsApp real (QR) ✔
4. Mandar "oi" de outro celular → conversa aparece no inbox ✔
5. Backup: `docker compose -f infra/docker-compose.yml logs backup` deve
   mostrar "serviço ativo" (primeiro dump às 03:30 UTC)
6. Monitoração: `ssh -L 3001:localhost:3001 root@SEU_IP` →
   `http://localhost:3001` (Uptime Kuma, criar monitor para o APP_URL)

## 6. Teste de restore (fazer no primeiro dia, não no dia do desastre)

```bash
cd /opt/clinicaos/infra
docker compose exec backup ls -la /backups
docker compose exec -T postgres pg_restore --list \
  /backups/clinicaos-XXXX.dump | head   # lista o conteúdo = dump íntegro
```

## Riscos operacionais (registrar com o cliente)

- **WhatsApp/Evolution**: API não oficial — banimento é risco real e
  correlacionado; versão pinada, upgrade só via canário. Recomende número
  dedicado para automações.
- **IA**: nunca afirma nem nega ser humana; pergunta direta escala para
  humano. Registrar aceite do cliente.
- **LGPD**: anamnese cifrada em aplicação; backups incluem dados de saúde —
  off-site (restic/B2) recomendado assim que possível.

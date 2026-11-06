# Deploying on the room PC

The app runs in Docker on the Ubuntu desktop in the room. The PC is on eduroam, which does
not accept incoming connections. A **Cloudflare Tunnel** solves that: the PC connects *out*
to Cloudflare, and people reach the app at `https://inventarius.portospaceteam.pt` from
anywhere. Phones also get the real HTTPS certificate they need before they allow the camera.

## 1. Install

```sh
sudo apt install docker.io docker-compose-v2 git
sudo usermod -aG docker $USER      # log out and in again
git clone <repo> inventarius && cd inventarius/deploy
cp env.example .env
```

## 2. Printer

Plug the PT-E550W in by USB and turn it on, then follow [printer.md](printer.md) to check that
`/dev/usb/lp0` appears.

## 3. Google sign-in

Someone with access to the `portospaceteam.pt` Google Workspace:

1. Google Cloud Console → create a project (e.g. "inventarius").
2. *APIs & Services → OAuth consent screen*: User type **Internal** (Workspace only).
3. *Credentials → Create credentials → OAuth client ID*: type **Web application**,
   authorized redirect URI `https://inventarius.portospaceteam.pt/auth/callback`.
4. Put the client ID and secret in `.env` (`INVENTARIUS_GOOGLE_CLIENT_ID/SECRET`), and your own
   email in `INVENTARIUS_ADMINS`.

Only verified `@portospaceteam.pt` accounts can sign in; the server checks this itself
(`hd` claim + email), not just Google's account picker.

## 4. Tunnel

This needs the `portospaceteam.pt` DNS zone on Cloudflare (the free plan is enough), or at
least a subdomain delegated to it.

1. Cloudflare dashboard → *Zero Trust → Networks → Tunnels → Create a tunnel* (cloudflared).
2. Copy the token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
3. Add public hostnames `inventarius.portospaceteam.pt` and `inv.portospaceteam.pt`
   (the short host used in QR labels), both pointing to service `http://inventarius:8080`.

If moving DNS to Cloudflare is not possible, Tailscale Funnel is a fallback. It gives a
`*.ts.net` address, which then becomes `INVENTARIUS_BASE_URL` and the Google redirect URI.

## 5. Start

```sh
docker compose up -d --build                 # app + backups
docker compose --profile tunnel up -d        # + tunnel
docker compose logs -f inventarius
```

Containers restart on their own after a reboot. To update:
`git pull && docker compose up -d --build`.

## Before Google sign-in exists

Set `INVENTARIUS_DEV_AUTH=true` and **do not start the tunnel**. Then use the app only on the PC
itself at http://localhost:8080. Dev login has no password: anyone who can reach the page can
sign in as anyone with a `@portospaceteam.pt` address.

## Without internet

Everything runs on the PC, so the app keeps working when the internet is down: browsing, scanning,
stock, printing and backups. Only these need internet:

- the part lookup and product photos from Mouser and DigiKey (it says so; fill in the details by hand),
- datasheet and supplier links, and Google sign-in,
- building a new image. `make up` then starts the image already built.

Phones still need a network shared with the PC, even one with no internet. The PC's address changes
with the network: `ip -4 addr` shows it.

If the page stops answering on a phone but works at http://localhost:8080 on the PC, the app is fine
and the problem is the network: the PC may have moved to another Wi-Fi, which changes its address. A
network cable or a fixed connection avoids this.

## Configuration

All settings are `INVENTARIUS_*` environment variables in `.env`; `env.example` documents them.

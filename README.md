# Wizard 3D

Das Stichspiel Wizard als 3D-Webspiel. Du spielst allein gegen Bots oder online mit Freunden, im Browser auf Desktop, Tablet und Handy.

- **3D-Grafik mit Three.js:** Holztisch mit Filz, leuchtender Magiekreis, schwebende Magielichter, Staub im Lichtkegel, Bloom, weiche Schatten und Partikel-Effekte.
- **Eigene Kartenkunst:** Alle Texturen werden prozedural im Browser gemalt, es gibt keine Bilddateien. Jedes der vier Völker (Menschen, Zwerge, Elfen, Riesen) hat ein eigenes Emblem. Die Zauberer tragen Hüte in den vier Völkerfarben, Goldprägung glänzt metallisch.
- **Animationen:** Mischen, Austeilen, Aufdecken des Trumpfs, Ausspielen mit Flugbahn, leuchtende Gewinnerkarte, Einsammeln der Stiche, Feuerwerk beim Spielende.
- **Einzelspieler** gegen 2–5 Bots in drei Stärken. Die Bots zählen Karten und schauen nie in fremde Hände. Der Spielstand wird gespeichert und lässt sich fortsetzen.
- **Online-Multiplayer** für 3–6 Spieler per Raumcode oder Einladungslink. Freie Plätze lassen sich mit Bots füllen. Es gibt einen Chat mit Sprechblasen und automatisches Wiederverbinden. Wer das Spiel verlässt, wird durch einen Bot ersetzt.
- **Regeloptionen:** volle, halbe oder kurze Spiellänge sowie die Variante „Gebote dürfen nicht aufgehen“.
- **Sounds** werden per WebAudio synthetisiert. Grafikqualität und Animationstempo sind einstellbar.

## Technik

| Teil | Technologie |
| --- | --- |
| Frontend | Vite, TypeScript, Three.js (ohne Framework) |
| Backend | Cloudflare Worker und **Durable Objects** (ein Objekt pro Spielraum, WebSocket-Hibernation) |
| Spiellogik | `src/shared/`: identisch im Browser (Einzelspieler) und auf dem Server (Multiplayer) |
| Hosting | Ein Cloudflare Worker liefert die statischen Dateien und die Spielräume aus |

```
src/
  shared/      Regeln, Bot-KI, Raum-Logik (läuft überall)
  worker/      Cloudflare Worker + Durable Object "GameRoom"
  client/
    three/     3D-Bühne, Texturen, Karten, Animationen, Partikel
    ui/        Menüs, Lobby, HUD, Styles
    net/       lokale Verbindung (Bots) & WebSocket-Verbindung
scripts/
  simulate.ts  simuliert tausende Bot-Spiele (Regeltest & KI-Tuning)
```

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run dev
```

Danach <http://localhost:5173> öffnen. Der Dev-Server führt den Worker samt Durable Objects lokal aus, Multiplayer funktioniert also auch lokal. Zum Testen öffnest du zwei Browserfenster, eines davon privat, damit es einen eigenen Spieler bekommt.

Weitere Befehle:

```bash
npm run typecheck   # TypeScript prüfen
npm run build       # Produktions-Build nach dist/
npm run sim         # 300 Bot-Spiele simulieren (Regeltest)
```

## Auf Cloudflare veröffentlichen

1. **Cloudflare-Konto** anlegen: <https://dash.cloudflare.com> (der kostenlose Plan reicht).
2. **Anmelden** (öffnet den Browser):

   ```bash
   npx wrangler login
   ```

3. **Deployen**:

   ```bash
   npm run deploy
   ```

   Danach läuft das Spiel unter `https://wizard.<dein-account>.workers.dev`.

### Eigene Domain verbinden

Die Domain muss bei Cloudflare verwaltet werden: Füge sie im Dashboard unter **Websites → Domain hinzufügen** hinzu und stelle die Nameserver bei deinem Registrar auf Cloudflare um.

**Variante A – im Dashboard:**
Workers & Pages → `wizard` → **Settings → Domains & Routes → Add → Custom Domain** → z. B. `wizard.deine-domain.de` eintragen. DNS-Eintrag und SSL-Zertifikat legt Cloudflare automatisch an.

**Variante B – in der Konfiguration:**
In `wrangler.jsonc` den Kommentar am Ende entfernen und die Domain eintragen:

```jsonc
"routes": [{ "pattern": "wizard.deine-domain.de", "custom_domain": true }]
```

Danach erneut `npm run deploy` ausführen. Das funktioniert genauso mit der Hauptdomain (`deine-domain.de`).

### Kosten

Workers und Durable Objects (mit SQLite-Speicher) sind im kostenlosen Plan enthalten. Ruhende Räume kosten dank WebSocket-Hibernation nichts, und leere Räume löschen sich nach zwei Stunden ohne Aktivität selbst. Für eine private Spielrunde reicht das Gratis-Kontingent locker.

## Admin-Seite

Unter `/admin` gibt es ein verstecktes Dashboard (nirgends verlinkt, für Suchmaschinen gesperrt). Es zeigt, wie viele Spiele wann gespielt wurden: Spiele pro Tag bzw. Woche, eine Heatmap nach Wochentag und Uhrzeit, Spielarten, Stammgäste und eine Liste der letzten Spiele. Ein Button löscht die komplette Statistik.

Erfasst werden Online-Spiele (vom Server) und Spiele gegen Bots (der Browser meldet Start und Ende). Gespeichert wird in einem eigenen Durable Object `GameStats` mit SQLite.

Die Seite ist mit einem Passwort geschützt:

- **Online:** einmalig setzen, danach ist es sofort aktiv:

  ```bash
  npx wrangler secret put ADMIN_PASSWORD
  ```

- **Lokal:** in die Datei `.dev.vars` schreiben (wird nicht eingecheckt) und den Dev-Server neu starten:

  ```
  ADMIN_PASSWORD=dein-langes-passwort
  ```

Ohne gesetztes Passwort zeigt `/admin` nur einen Hinweis, wie man es einrichtet.

## Spielregeln (Kurzfassung)

- 60 Karten: Zahlen 1–13 in vier Farben sowie je 4 Zauberer und 4 Narren.
- In Runde *n* bekommt jeder *n* Karten. Die nächste Karte vom Stapel bestimmt Trumpf: Ein Narr bedeutet kein Trumpf, bei einem Zauberer wählt der Geber.
- Jeder sagt an, wie viele Stiche er macht. Die ausgespielte Farbe muss bedient werden, Zauberer und Narren gehen immer.
- Der erste Zauberer gewinnt den Stich, sonst der höchste Trumpf, sonst die höchste Karte der ausgespielten Farbe.
- Gebot genau getroffen: 20 Punkte + 10 pro Stich. Daneben: −10 pro Stich Abweichung.

Die vollständigen Regeln stehen im Spiel unter **Regeln**.

## Bedienung

- **Maus:** Karte anklicken, um sie auszuspielen. Beim Überfahren hebt sich die Karte an.
- **Touch:** einmal tippen zum Anheben, nochmal tippen zum Ausspielen.
- **Tastatur:** Ziffern 0–9 zum Bieten.
- 📜 Punktetabelle · 👁 letzter Stich · 💬 Chat (online) · ⚙ Einstellungen.

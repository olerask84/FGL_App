# FGL PWA

PWA til Funder Golf League med spiller-vælger fra Google Sheet og forebyggelse af dubletter.

## Sådan kører du lokalt

1. Pak zip-filen ud i en mappe og servér mappen via en lille HTTP-server (PWA kræver http/https).
   - Hurtigt (Python):
     ```bash
     python3 -m http.server 8080
     ```
     Åbn derefter http://localhost:8080

2. Dit Google Sheet skal være **delt** (Alle med link kan se) eller **Udgivet på webben**.
   - `SHEET_ID` er sat i `app.js`.
   - `SHEET_NAME` er sat til `Spiller`.
   - Kolonnerne skal hedde **"Navn"** og **"Fane Navn"**.

3. Klik **Tilføj spiller** for at åbne vælgeren. Vælg en spiller.
   - Fanens navn = **Fane Navn** (eller **Navn**, hvis "Fane Navn" er tom).
   - Dubletter blokeres.

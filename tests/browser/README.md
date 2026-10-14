# Browsertests

End-to-end tests voor de scanapp (`scan.html`) en de cadeaubonnen in het dashboard. Ze draaien in een
headless Chromium tegen een **nep-API** (`mock-api.js`), niet tegen de echte backend. Er wordt dus
niets op productie aangemaakt of afgeschreven.

Ze horen **niet** bij `npm test` (de snelle unittests); je draait ze apart.

## Eenmalig installeren

Nodig: Node.js 18 of nieuwer (getest met Node 24).

```sh
npm --prefix tests/browser install
npx --prefix tests/browser playwright install chromium
```

Playwright staat bewust in `tests/browser/package.json` en niet in de root: de site wordt door Vercel
uitgerold zonder build, en zo hoeft Vercel bij een deploy niets te installeren.

## Draaien

```sh
npm run test:browser                      # alle suites
npm run test:browser -- scanapp           # alleen de scanapp
npm run test:browser -- stamp-regression dashboard-giftcards
```

Het commando start zelf de nep-API op poort 8799 (anders: `TEST_PORT=9000 npm run test:browser`) en
sluit hem na afloop. Exitcode 0 = alles geslaagd. Schermafbeeldingen komen in `tests/browser/output/`
(staat in `.gitignore`).

## Wat er getest wordt

| Suite | Bestand | Inhoud |
|---|---|---|
| `scanapp` | `suites/scanapp.js` + `suites/stamp-sequence.js` | Stempelflow en cadeaubonflow in `scan.html`, plus **onderdeel S**: meerdere stempels en inwisselingen achter elkaar zonder reload, na een server- of netwerkfout en na een Special Guest, op Basic en Premium Plus |
| `stamp-regression` | `suites/stamp-regression.js` | Stempel geven en inwisselen in `scan.html` en Geef Stempel in het dashboard, op Basic en Premium Plus |
| `dashboard-giftcards` | `suites/dashboard-giftcards.js` | Pagina Cadeaubonnen: lijst, aanmaken, detail, eigenaar-acties, rapport, toegang per pakket, schermformaten |
| `dashboard-scanner` | `suites/dashboard-scanner.js` | Geef Stempel met de keuze Stempelen \| Cadeaubon: zichtbaarheid per pakket, `/scan/resolve`, afschrijven, foutmeldingen, terugval, onthouden per apparaat, camera wisselen, schermformaten |

## Nep-API

`mock-api.js` serveert de site uit de repo en beantwoordt de API-aanroepen met een staat in het geheugen.
Testaccounts (token in `localStorage`): `tok-pp` (Premium Plus, eigenaar), `tok-mgr` (manager van die zaak),
`tok-basic`, `tok-trial` (proef op Basic), `tok-ptrial` (proef op Premium), `tok-pptrial` (proef op Premium Plus).
Beheer-routes voor de tests: `POST /__reset`, `POST /__cfg` (foutstanden zoals `notLive`, `rateLimited`,
`giveFail`), `GET /__state`.

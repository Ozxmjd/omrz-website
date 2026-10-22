// Siteconfiguratie: welke backend deze pagina gebruikt, bepaald op het domein waarop hij draait.
// Eén bron voor alle pagina's die de API aanroepen. Ook te laden in Node voor tests.
(function (root) {
  'use strict';
  const DEFAULT_API_BASE = 'https://api.omrzdigital.nl';
  // Per domein de API. Hosts die hier niet staan gebruiken DEFAULT_API_BASE.
  const API_BASE_BY_HOST = {
    // TODO(oneplume): zet deze twee op 'https://api.oneplume.nl' zodra api.oneplume.nl live staat.
    'oneplume.nl': 'https://api.omrzdigital.nl',
    'www.oneplume.nl': 'https://api.omrzdigital.nl',
  };
  // Hostnaam zonder poort en zonder afsluitende punt, in kleine letters.
  function normalizeHost(host) {
    return String(host == null ? '' : host).trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  }
  function apiBaseFor(host) {
    const h = normalizeHost(host);
    return Object.prototype.hasOwnProperty.call(API_BASE_BY_HOST, h) ? API_BASE_BY_HOST[h] : DEFAULT_API_BASE;
  }

  const here = root && root.location ? root.location.hostname : '';
  const api = { DEFAULT_API_BASE, API_BASE_BY_HOST, apiBaseFor, API_BASE: apiBaseFor(here) };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteConfig = api;
})(typeof window !== 'undefined' ? window : globalThis);

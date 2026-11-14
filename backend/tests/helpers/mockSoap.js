// Local SOAP 1.1 / 1.2 mock "Calculator" service + WSDL for tests. Serves:
//   GET  /calculator.wsdl        the WSDL (endpoint placeholders filled in)
//   GET  /calculator-types.xsd   the imported schema
//   POST /soap11, /soap12        Add, Divide (Divide by zero returns a SOAP Fault)
//   GET  /evil-*.wsdl            hostile documents used by the security tests
const fs = require('fs');
const path = require('path');
const { startMock } = require('./mockUpstream');

const FIX = path.join(__dirname, '..', 'fixtures');
const NS = 'http://bridgex.test/calculator';

function startSoapMock() {
  return startMock((req, res, body, hit) => {
    const base = `http://127.0.0.1:${mock.port}`;
    const send = (status, type, text) => { res.writeHead(status, { 'content-type': type }); res.end(text); };
    const { pathname } = new URL(req.url, base);

    if (req.method === 'GET' && pathname === '/calculator.wsdl') return send(200, 'text/xml', fs.readFileSync(path.join(FIX, 'calculator.wsdl'), 'utf8').replace(/{{ENDPOINT}}/g, base));
    if (req.method === 'GET' && pathname === '/calculator-types.xsd') return send(200, 'text/xml', fs.readFileSync(path.join(FIX, 'calculator-types.xsd'), 'utf8'));
    if (req.method === 'GET' && pathname === '/evil-xxe.wsdl') {
      return send(200, 'text/xml', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">&x;</wsdl:definitions>');
    }
    if (req.method === 'GET' && pathname === '/evil-bomb.wsdl') {
      return send(200, 'text/xml', '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">&b;</wsdl:definitions>');
    }
    const evilImport = (loc) => `<?xml version="1.0"?><wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:evil"><wsdl:types><xsd:schema><xsd:import namespace="urn:x" schemaLocation="${loc}"/></xsd:schema></wsdl:types></wsdl:definitions>`;
    if (pathname === '/evil-import-file.wsdl') return send(200, 'text/xml', evilImport('file:///etc/passwd'));
    if (pathname === '/evil-import-metadata.wsdl') return send(200, 'text/xml', evilImport('http://169.254.169.254/latest/meta-data'));
    if (pathname === '/evil-import-private.wsdl') return send(200, 'text/xml', evilImport('http://10.0.0.5/x.xsd'));
    if (pathname === '/evil-import-otherhost.wsdl') return send(200, 'text/xml', evilImport('http://example.com/x.xsd'));
    if (pathname === '/evil-redirect.wsdl') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
    if (pathname === '/huge.wsdl') return send(200, 'text/xml', `<?xml version="1.0"?><wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/">${'<!-- -->'.repeat(400000)}</wsdl:definitions>`);
    if (pathname === '/not-wsdl.wsdl') return send(200, 'text/xml', '<?xml version="1.0"?><html><body>nope</body></html>');

    if (req.method === 'POST' && (pathname === '/soap11' || pathname === '/soap12')) {
      const v12 = pathname === '/soap12';
      const envNs = v12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
      const ctype = v12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8';
      const wrap = (inner) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="${envNs}"><soap:Body>${inner}</soap:Body></soap:Envelope>`;
      const op = /<(?:\w+:)?(Add|Divide)[\s>]/.exec(body);
      const num = (n) => { const m = new RegExp(`<(?:\\w+:)?${n}>(-?\\d+)</`).exec(body); return m ? Number(m[1]) : NaN; };
      if (!op) {
        const fault = v12
          ? '<soap:Fault><soap:Code><soap:Value>soap:Sender</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">Unknown operation</soap:Text></soap:Reason></soap:Fault>'
          : '<soap:Fault><faultcode>soap:Client</faultcode><faultstring>Unknown operation</faultstring></soap:Fault>';
        return send(500, ctype, wrap(fault));
      }
      const a = num('a'); const b = num('b');
      if (op[1] === 'Add') return send(200, ctype, wrap(`<AddResponse xmlns="${NS}"><AddResult>${a + b}</AddResult></AddResponse>`));
      if (b === 0) {
        const fault = v12
          ? '<soap:Fault><soap:Code><soap:Value>soap:Sender</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">Division by zero</soap:Text></soap:Reason><soap:Detail><reason>b must not be 0</reason></soap:Detail></soap:Fault>'
          : '<soap:Fault><faultcode>soap:Client</faultcode><faultstring>Division by zero</faultstring><detail><reason>b must not be 0</reason></detail></soap:Fault>';
        return send(500, ctype, wrap(fault));
      }
      return send(200, ctype, wrap(`<DivideResponse xmlns="${NS}"><DivideResult>${Math.trunc(a / b)}</DivideResult></DivideResponse>`));
    }
    return send(404, 'text/plain', 'not found');
  });
}
let mock;
module.exports = { startSoapMock: async () => { mock = await startSoapMock(); return mock; }, NS };

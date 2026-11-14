# SOAP / WSDL in BridgeX (checklist item 15)

A SOAP integration stores the endpoint, the WSDL URL (`config.wsdlUrl`) and the SOAP version (`config.soapVersion`, 1.1 or 1.2).
BridgeX downloads the WSDL (following `<import>`/`<xsd:import>` only to http(s) on the **same origin**, at most `SOAP_WSDL_MAX_IMPORTS`), lists the operations and makes real SOAP calls
through the shared outbound client (timeouts, retry, circuit breaker `integration:<id>`). Calls use the **configured endpoint**, not the address inside the WSDL.

Security: documents containing DOCTYPE/ENTITY are refused (XXE, entity bombs); `file://`, private/metadata addresses, other hosts and redirects to them are refused; WSDL and response sizes are capped; credentials are never logged or returned.

Endpoints: `GET /integrations/:id/operations`, `POST /integrations/:id/verifications`, `POST /integrations/:id/soap`.

## Real operations / verification / call (captured from a running test against a local SOAP 1.1/1.2 Calculator service)

Operations:
```
{
  "success": true,
  "data": {
    "service": "Calculator",
    "port": "CalculatorSoap",
    "wsdlUrl": "http://127.0.0.1:41939/calculator.wsdl",
    "operations": [
      {
        "name": "Add",
        "soapAction": "http://bridgex.test/calculator/Add",
        "input": {
          "a": "xsd:int",
          "b": "xsd:int"
        },
        "output": {
          "AddResult": "xsd:int"
        }
      },
      {
        "name": "Divide",
        "soapAction": "http://bridgex.test/calculator/Divide",
        "input": {
          "a": "xsd:int",
          "b": "xsd:int"
        },
        "output": {
          "DivideResult": "xsd:int"
        }
      }
    ]
  },
  "message": "Request successful"
}
```
Verification (downloads and parses the WSDL):
```
HTTP 201
{
  "success": true,
  "data": {
    "integrationId": 129,
    "protocol": "SOAP",
    "status": "Connected",
    "checkedAt": "2026-11-06T02:57:41.138Z",
    "latencyMs": 0,
    "details": {
      "service": "Calculator",
      "port": "CalculatorSoap",
      "operations": 2
    }
  },
  "message": "Integration verified"
}
```
Call:
```
POST /api/v1/integrations/<id>/soap
{
  "operation": "Add",
  "arguments": {
    "a": 2,
    "b": 3
  }
}
```
SOAP envelope actually sent on the wire (text/xml; charset=utf-8, SOAPAction "http://bridgex.test/calculator/Add"):
```xml
<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"  xmlns:tns="http://bridgex.test/calculator"><soap:Body><Add xmlns="http://bridgex.test/calculator"><a>2</a><b>3</b></Add></soap:Body></soap:Envelope>
```
Response:
```
HTTP 200
{
  "success": true,
  "data": {
    "operation": "Add",
    "soapVersion": "1.1",
    "result": {
      "AddResult": 5
    },
    "durationMs": 4,
    "responseBytes": 237
  },
  "message": "SOAP call completed"
}
```
WSDL fetches seen by the SOAP service: POST /soap11

SOAP Fault (Divide by 0) becomes a unified error:
```
HTTP 502
{
  "success": false,
  "error": {
    "code": "SOAP_FAULT",
    "message": "The SOAP service returned a fault.",
    "details": [
      {
        "field": "fault",
        "message": "Division by zero",
        "code": "soap:Client",
        "detail": "{\"reason\":\"b must not be 0\"}"
      }
    ],
    "correlationId": "41196fae-84d4-4481-8971-6f15fc9cd4bf"
  }
}
```

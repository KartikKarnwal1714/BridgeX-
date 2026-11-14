import { useState } from 'react'
import { AlertTriangle, Braces, FileCode2, ShieldCheck, Timer } from 'lucide-react'

const ERROR_EXAMPLE = `{
  "success": false,
  "error": {
    "code": "CIRCUIT_OPEN",
    "message": "The upstream is temporarily unavailable. Try again later.",
    "details": [],
    "correlationId": "9b6e5c0e-6f0b-4a53-9f43-2f6a9c1d7e11"
  }
}`

const GRAPHQL_REQUEST = `POST /api/v1/graphql
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "query": "query Q($id: Int!) { api(id: $id) { id name protocol } }",
  "variables": { "id": 1 },
  "operationName": "Q"
}`

const GRAPHQL_RESPONSE = `HTTP 200
{ "data": { "api": { "id": 1, "name": "<your API name>", "protocol": "REST" } } }`

const SOAP_REQUEST = `POST /api/v1/integrations/12/soap
Authorization: Bearer <jwt>

{ "operation": "Add", "arguments": { "a": 2, "b": 3 } }`

const SOAP_RESPONSE = `HTTP 200
{ "success": true,
  "data": { "operation": "Add", "soapVersion": "1.1", "result": { "AddResult": 5 }, "durationMs": 4 },
  "message": "SOAP call completed" }`

const TABS = [
  { id: 'errors', label: 'Error format', icon: AlertTriangle },
  { id: 'graphql', label: 'GraphQL', icon: Braces },
  { id: 'soap', label: 'SOAP / WSDL', icon: FileCode2 },
  { id: 'reliability', label: 'Timeouts, retries & breaker', icon: Timer },
]

function Code({ children }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 font-mono-num text-[11px] leading-relaxed text-gray-100">{children}</pre>
  )
}

export default function ProtocolGuide() {
  const [tab, setTab] = useState('errors')
  return (
    <section className="mb-6 rounded-xl border border-gray-100">
      <div className="flex flex-wrap gap-1 border-b border-gray-100 bg-gray-50/60 p-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === id ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="space-y-3 p-4 text-sm text-gray-600">
        {tab === 'errors' && (
          <>
            <p>
              Every error BridgeX itself generates has the same body, on every endpoint, including the gateway. Quote the{' '}
              <code className="font-mono-num">correlationId</code> when reporting a problem; it is also returned in the{' '}
              <code className="font-mono-num">X-Correlation-Id</code> header.
            </p>
            <Code>{ERROR_EXAMPLE}</Code>
            <p className="flex items-start gap-2 text-xs text-gray-500">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" />
              Responses from an upstream service that the gateway proxies are passed through unchanged; BridgeX does not control their format. Errors created by the
              gateway itself carry the response header <code className="font-mono-num">X-BridgeX-Error: true</code>.
            </p>
          </>
        )}
        {tab === 'graphql' && (
          <>
            <p>
              BridgeX exposes a real GraphQL endpoint next to REST at <code className="font-mono-num">/api/v1/graphql</code> (POST, or GET for queries). It uses the same
              authentication, roles and services as REST. Depth, complexity, size and rate limits apply. You can also forward queries to an external GraphQL integration with{' '}
              <code className="font-mono-num">POST /integrations/:id/graphql</code>.
            </p>
            <Code>{GRAPHQL_REQUEST}</Code>
            <Code>{GRAPHQL_RESPONSE}</Code>
            <p className="text-xs text-gray-500">
              Problems before execution (syntax, validation, limits, authentication) return an HTTP error status with the standard error body plus a GraphQL{' '}
              <code className="font-mono-num">errors</code> array. Errors inside a resolver return HTTP 200 with <code className="font-mono-num">errors</code>, as the GraphQL spec says.
            </p>
          </>
        )}
        {tab === 'soap' && (
          <>
            <p>
              Register a SOAP integration with its WSDL URL. BridgeX reads the WSDL (including imported schemas from the same host), lists its operations at{' '}
              <code className="font-mono-num">GET /integrations/:id/operations</code> and calls them as real SOAP 1.1 or 1.2 requests. SOAP faults are returned as{' '}
              <code className="font-mono-num">SOAP_FAULT</code> errors.
            </p>
            <Code>{SOAP_REQUEST}</Code>
            <Code>{SOAP_RESPONSE}</Code>
            <p className="text-xs text-gray-500">
              WSDLs that use DOCTYPE/entities, import files or other hosts, or point at private addresses are refused. The endpoint configured on the integration is used, not the
              address written inside the WSDL.
            </p>
          </>
        )}
        {tab === 'reliability' && (
          <ul className="list-disc space-y-2 pl-5">
            <li><span className="font-medium text-gray-700">Timeouts:</span> every outbound call has connect, response and total time limits. A call that runs out of time returns 504 <code className="font-mono-num">UPSTREAM_TIMEOUT</code>.</li>
            <li><span className="font-medium text-gray-700">Retry:</span> transient failures are retried with exponentially increasing, jittered delays. The gateway only retries requests that are safe to repeat (no body) and only for 502, 503 and 504; a POST is never retried by the gateway.</li>
            <li><span className="font-medium text-gray-700">Circuit breaker:</span> after repeated upstream failures the circuit opens (CLOSED, OPEN, HALF_OPEN). While open, calls fail immediately with 503 <code className="font-mono-num">CIRCUIT_OPEN</code> and a <code className="font-mono-num">Retry-After</code> header. State is shared between instances through Redis; if Redis is unreachable each instance falls back to its own memory.</li>
            <li><span className="font-medium text-gray-700">Visibility:</span> attempts, retries, timeouts and breaker state are recorded in Logs and summarised in Analytics and System Health.</li>
          </ul>
        )}
      </div>
    </section>
  )
}

import Foundation
import Network

/// Serves packaged UI on loopback. Agent execution stays on the selected server.
final class LocalWebServer {
    private let queue = DispatchQueue(label: "top.goldgom.tokenbird.webui")
    private var listener: NWListener?
    private let root: URL
    private let config: Data

    init(serverURL: String, token: String) throws {
        guard let root = Bundle.main.url(forResource: "WebUI", withExtension: nil) else {
            throw NSError(domain: "TokenBird", code: 1, userInfo: [NSLocalizedDescriptionKey: "Bundled WebUI is missing."])
        }
        self.root = root.resolvingSymlinksInPath()
        config = try JSONSerialization.data(withJSONObject: ["wsUrl": serverURL, "token": token, "mode": "remote"])
    }

    func start(completion: @escaping (Result<URL, Error>) -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        var completed = false
        listener.stateUpdateHandler = { [weak listener] state in
            if completed { return }
            switch state {
            case .ready:
                guard let port = listener?.port,
                      let url = URL(string: "http://127.0.0.1:\(port.rawValue)/index.html?embedded=ios") else { return }
                completed = true
                DispatchQueue.main.async { completion(.success(url)) }
            case .failed(let error):
                completed = true
                DispatchQueue.main.async { completion(.failure(error)) }
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, accumulated: Data())
        }
        listener.start(queue: queue)
    }

    func stop() { listener?.cancel(); listener = nil }
    deinit { stop() }

    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, complete, error in
            guard let self else { connection.cancel(); return }
            var request = accumulated
            if let data { request.append(data) }
            if request.count > 32_768 { connection.cancel(); return }
            if request.range(of: Data("\r\n\r\n".utf8)) != nil {
                self.respond(connection, request: request)
            } else if complete || error != nil {
                connection.cancel()
            } else {
                self.receive(connection, accumulated: request)
            }
        }
    }

    private func respond(_ connection: NWConnection, request: Data) {
        let lines = String(decoding: request, as: UTF8.self).components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ")
        guard parts.count == 3, parts[0] == "GET" || parts[0] == "HEAD" else {
            send(connection, status: "405 Method Not Allowed", type: "text/plain", data: Data()); return
        }
        // Reject cross-origin requests for the connection token and DNS rebinding.
        let authority = "127.0.0.1:\(listener?.port?.rawValue ?? 0)"
        let headers = lines.dropFirst().reduce(into: [String: String]()) { result, line in
            if let colon = line.firstIndex(of: ":") {
                result[String(line[..<colon]).lowercased()] = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            }
        }
        guard headers["host"] == authority,
              headers["origin"] == nil || headers["origin"] == "http://\(authority)" else {
            send(connection, status: "403 Forbidden", type: "text/plain", data: Data()); return
        }
        let path = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding ?? ""
        if path == "/api/mobile-config" {
            send(connection, status: "200 OK", type: "application/json", data: config, head: parts[0] == "HEAD"); return
        }
        let file = root.appendingPathComponent(path == "/" ? "index.html" : String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
        guard path.hasPrefix("/"), file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            send(connection, status: "404 Not Found", type: "text/plain", data: Data()); return
        }
        let types = ["html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
                     "json": "application/json", "png": "image/png", "svg": "image/svg+xml", "ico": "image/x-icon",
                     "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp", "woff": "font/woff", "woff2": "font/woff2",
                     "xml": "application/xml", "wasm": "application/wasm", "pdf": "application/pdf"]
        send(connection, status: "200 OK", type: types[file.pathExtension.lowercased()] ?? "application/octet-stream", data: data, head: parts[0] == "HEAD")
    }

    private func send(_ connection: NWConnection, status: String, type: String, data: Data, head: Bool = false) {
        var response = Data("HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n".utf8)
        if !head { response.append(data) }
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}

/** The backend could not be reached at all. */
export class BackendUnreachable extends Error {
    constructor(baseUrl, detail) {
        super(`无法连接后端（${baseUrl}）：${detail}。请先启动后端。`);
        this.name = 'BackendUnreachable';
    }
}
/** The backend answered with a non-2xx status. */
export class BackendHttpError extends Error {
    path;
    status;
    body;
    constructor(path, status, body, message) {
        super(message);
        this.path = path;
        this.status = status;
        this.body = body;
        this.name = 'BackendHttpError';
    }
}
function encodeQuery(query) {
    if (!query)
        return '';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null)
            continue;
        if (Array.isArray(value)) {
            if (value.length === 0)
                continue;
            params.set(key, value.join(','));
        }
        else {
            params.set(key, String(value));
        }
    }
    const encoded = params.toString();
    return encoded ? `?${encoded}` : '';
}
function describe(error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        return '请求超时';
    }
    const cause = error.cause;
    if (cause?.code === 'ECONNREFUSED')
        return '连接被拒绝，后端进程未启动';
    return cause?.message ?? (error instanceof Error ? error.message : String(error));
}
/** One JSON-over-HTTP client bound to the resolved configuration. */
export class GetJobsClient {
    config;
    constructor(config) {
        this.config = config;
    }
    get baseUrl() {
        return this.config.baseUrl;
    }
    /** Low-level request; callers usually use the helpers below. */
    async request(method, path, options = {}) {
        const url = `${this.config.baseUrl}${path}${encodeQuery(options.query)}`;
        const headers = { accept: 'application/json' };
        const init = {
            method,
            headers,
            signal: AbortSignal.timeout(options.timeoutMs ?? this.config.timeoutMs),
        };
        if (options.body !== undefined) {
            headers['content-type'] = 'application/json';
            init.body = JSON.stringify(options.body);
        }
        let response;
        try {
            response = await fetch(url, init);
        }
        catch (error) {
            throw new BackendUnreachable(this.config.baseUrl, describe(error));
        }
        const raw = await response.text();
        let parsed;
        if (raw.length > 0) {
            try {
                parsed = JSON.parse(raw);
            }
            catch {
                parsed = raw;
            }
        }
        if (!response.ok) {
            const record = (parsed ?? {});
            const detail = typeof record['message'] === 'string' ? record['message'] : response.statusText;
            throw new BackendHttpError(path, response.status, parsed, `${method} ${path} 返回 ${response.status}：${detail}`);
        }
        return parsed;
    }
    get(path, options = {}) {
        return this.request('GET', path, options);
    }
    post(path, body) {
        return this.request('POST', path, { body });
    }
    put(path, body) {
        return this.request('PUT', path, { body });
    }
    delete(path) {
        return this.request('DELETE', path);
    }
}

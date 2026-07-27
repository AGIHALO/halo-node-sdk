export class HaloAPIError extends Error {
    statusCode?: number;
    responseBody?: unknown;
    code?: string;

    constructor(
        message: string,
        statusCode?: number,
        responseBody?: unknown,
        code?: string
    ) {
        super(message);
        this.name = "HaloAPIError";
        this.statusCode = statusCode;
        this.responseBody = responseBody;
        this.code = code;
    }
}

package com.cartera.exception;

import lombok.Getter;
import org.springframework.http.HttpStatus;

/** Error de negocio con su código HTTP y un mensaje que se puede enseñar al usuario. */
@Getter
public class ApiException extends RuntimeException {

    private final HttpStatus status;

    public ApiException(HttpStatus status, String message) {
        super(message);
        this.status = status;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(HttpStatus.NOT_FOUND, message);
    }

    public static ApiException conflict(String message) {
        return new ApiException(HttpStatus.CONFLICT, message);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(HttpStatus.UNAUTHORIZED, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(HttpStatus.FORBIDDEN, message);
    }

    /** Se ha superado un tope por cuenta (ver {@code Quotas}): 422, no un fallo ni un conflicto. */
    public static ApiException limit(String message) {
        return new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, message);
    }

    public static ApiException busy(String message) {
        return new ApiException(HttpStatus.TOO_MANY_REQUESTS, message);
    }
}

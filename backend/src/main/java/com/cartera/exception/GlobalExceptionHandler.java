package com.cartera.exception;

import com.cartera.dto.ErrorResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.List;

/** Traduce las excepciones a {@link ErrorResponse}, el formato que espera el frontend. */
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<ErrorResponse> api(ApiException e) {
        return ResponseEntity.status(e.getStatus()).body(new ErrorResponse(e.getMessage()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ErrorResponse> status(ResponseStatusException e) {
        String reason = e.getReason() != null ? e.getReason() : "Error " + e.getStatusCode().value();
        return ResponseEntity.status(e.getStatusCode()).body(new ErrorResponse(reason));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> invalid(MethodArgumentNotValidException e) {
        List<String> issues = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + ": " + f.getDefaultMessage()).toList();
        return ResponseEntity.badRequest().body(new ErrorResponse("Revisa los datos enviados.", issues));
    }

    @ExceptionHandler(InvalidDataException.class)
    public ResponseEntity<ErrorResponse> invalidData(InvalidDataException e) {
        return ResponseEntity.badRequest().body(new ErrorResponse(e.getMessage(), e.getIssues()));
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ErrorResponse> invalidParams(HandlerMethodValidationException e) {
        List<String> issues = e.getParameterValidationResults().stream()
                .flatMap(r -> r.getResolvableErrors().stream()
                        .map(err -> r.getMethodParameter().getParameterName() + ": " + err.getDefaultMessage()))
                .toList();
        return ResponseEntity.badRequest().body(new ErrorResponse("Revisa los datos enviados.", issues));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class,
            MissingServletRequestParameterException.class})
    public ResponseEntity<ErrorResponse> unreadable(Exception e) {
        return ResponseEntity.badRequest().body(new ErrorResponse("La petición no es válida."));
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> method(HttpRequestMethodNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).body(new ErrorResponse("Método no permitido."));
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ErrorResponse> mediaType(HttpMediaTypeNotSupportedException e) {
        return ResponseEntity.status(HttpStatus.UNSUPPORTED_MEDIA_TYPE).body(new ErrorResponse("Formato no admitido."));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> notFound(NoResourceFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(new ErrorResponse("No encontrado."));
    }

    /**
     * Dos peticiones a la vez que chocan en una restricción única (el mismo alta en dos pestañas, el primer acceso
     * con Google repetido…) o en una fila que otra acaba de cambiar o borrar: es un conflicto, no un error interno.
     */
    @ExceptionHandler({DataIntegrityViolationException.class, OptimisticLockingFailureException.class})
    public ResponseEntity<ErrorResponse> conflict(Exception e) {
        log.info("Conflicto de concurrencia: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(new ErrorResponse("Otra petición ha cambiado estos datos a la vez. Recarga y vuelve a intentarlo."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> unexpected(Exception e) {
        log.error("Error no controlado", e);
        return ResponseEntity.internalServerError().body(new ErrorResponse("Error interno. Vuelve a intentarlo."));
    }
}

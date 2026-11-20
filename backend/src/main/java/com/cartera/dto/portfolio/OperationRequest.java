package com.cartera.dto.portfolio;

import com.cartera.model.OperationType;
import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;

/**
 * Alta o cambio de una operación. Los campos que faltan toman su valor por defecto (comisiones 0, cambio 1…),
 * el ticker va en mayúsculas y los textos sin espacios a los lados.
 */
@OperationRequest.Consistent
public record OperationRequest(
        @NotNull @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}", message = "Fecha AAAA-MM-DD") String date,
        @NotBlank @Size(max = 32) String ticker,
        @NotNull OperationType type,
        @PositiveOrZero Double shares,
        @PositiveOrZero Double price,
        @PositiveOrZero Double fees,
        @Positive Double fxRate,
        @NotNull Double amountEur,
        @PositiveOrZero Double withholdingEs,
        @PositiveOrZero Double withholdingForeign,
        @Positive Double splitRatio,
        @Size(max = 40) String broker,
        @Size(max = 1000) String notes,
        Boolean needsReview,
        @Pattern(regexp = "manual|excel") String source,
        Integer sourceRef,
        Integer lotRef,
        @Min(1) @Max(99) Integer dayOrder,
        @Size(min = 1, max = 100) String transferRef) {

    public OperationRequest {
        ticker = ticker == null ? null : ticker.trim().toUpperCase();
        fees = fees == null ? 0 : fees;
        fxRate = fxRate == null ? 1 : fxRate;
        broker = broker == null ? null : broker.trim();
        needsReview = needsReview != null && needsReview;
        source = source == null ? "manual" : source;
        transferRef = transferRef == null ? null : transferRef.trim();
    }

    public LocalDate localDate() {
        return LocalDate.parse(date);
    }

    public OperationRequest withSource(String value) {
        return new OperationRequest(date, ticker, type, shares, price, fees, fxRate, amountEur, withholdingEs,
                withholdingForeign, splitRatio, broker, notes, needsReview, value, sourceRef, lotRef, dayOrder, transferRef);
    }

    /** Reglas que dependen del tipo de operación (acciones, importe, ratio, referencia del traspaso). */
    @Target(ElementType.TYPE)
    @Retention(RetentionPolicy.RUNTIME)
    @Constraint(validatedBy = ConsistentValidator.class)
    public @interface Consistent {
        String message() default "Operación no válida";
        Class<?>[] groups() default {};
        Class<? extends Payload>[] payload() default {};
    }

    public static class ConsistentValidator implements ConstraintValidator<Consistent, OperationRequest> {

        @Override
        public boolean isValid(OperationRequest o, ConstraintValidatorContext ctx) {
            if (o.type() == null || o.amountEur() == null) return true;
            ctx.disableDefaultConstraintViolation();
            boolean ok = true;
            double shares = o.shares() == null ? 0 : o.shares();
            double amount = o.amountEur();
            OperationType t = o.type();
            boolean transfer = t == OperationType.TRANSFER_OUT || t == OperationType.TRANSFER_IN;
            if (o.date() != null && o.date().matches("\\d{4}-\\d{2}-\\d{2}")) {
                try {
                    o.localDate();
                } catch (DateTimeParseException e) {
                    ok = fail(ctx, "date", "Fecha AAAA-MM-DD");
                }
            }
            if (t == OperationType.BUY || t == OperationType.SELL || transfer) {
                if (shares <= 0) ok = fail(ctx, "shares", "Indica cuántas acciones");
                if (amount < 0) ok = fail(ctx, "amountEur", "El importe no puede ser negativo");
            }
            if (transfer) {
                if (o.transferRef() == null || o.transferRef().isEmpty()) ok = fail(ctx, "transferRef", "Indica la referencia común del traspaso");
                if (amount <= 0) ok = fail(ctx, "amountEur", "Indica el importe traspasado");
            } else if (o.transferRef() != null && !o.transferRef().isEmpty()) {
                ok = fail(ctx, "transferRef", "La referencia solo corresponde a un traspaso");
            }
            if (t == OperationType.BUY && amount <= 0) ok = fail(ctx, "amountEur", "Indica el importe total en euros");
            if (t == OperationType.SCRIP && shares <= 0) ok = fail(ctx, "shares", "Indica cuántas acciones has recibido");
            if (t == OperationType.SPLIT && (o.splitRatio() == null || o.splitRatio() == 1)) {
                ok = fail(ctx, "splitRatio", "Indica el ratio (p. ej. 2 = cada acción pasa a ser 2)");
            }
            if (t.isIncome() && amount < 0) ok = fail(ctx, "amountEur", "El importe bruto no puede ser negativo");
            if (!Double.isFinite(amount)) ok = fail(ctx, "amountEur", "El importe no es un número válido");
            return ok;
        }

        private static boolean fail(ConstraintValidatorContext ctx, String field, String message) {
            ctx.buildConstraintViolationWithTemplate(message).addPropertyNode(field).addConstraintViolation();
            return false;
        }
    }
}

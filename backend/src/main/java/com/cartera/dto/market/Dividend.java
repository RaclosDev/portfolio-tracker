package com.cartera.dto.market;

/** Un dividendo: fecha ex (día de la bolsa) e importe por acción, en la escala de hoy (tras splits). */
public record Dividend(String date, double amount) {
}

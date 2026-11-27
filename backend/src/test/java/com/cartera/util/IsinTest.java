package com.cartera.util;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class IsinTest {

    @Test
    void realIsinsHaveAValidCheckDigit() {
        assertThat(Isin.hasValidCheckDigit("ES0113900J37")).isTrue(); // Santander
        assertThat(Isin.hasValidCheckDigit("US0378331005")).isTrue(); // Apple
        assertThat(Isin.hasValidCheckDigit(" ie00b4l5y983 ")).isTrue(); // iShares Core MSCI World
    }

    @Test
    void madeUpIsinsAreRejected() {
        assertThat(Isin.hasValidCheckDigit("ES0113900J38")).isFalse();
        assertThat(Isin.hasValidCheckDigit("US0378331006")).isFalse();
        assertThat(Isin.hasValidCheckDigit("XX")).isFalse();
        assertThat(Isin.hasValidCheckDigit(null)).isFalse();
    }
}

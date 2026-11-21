package com.cartera.service.market;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class FinancialHubLogoTest {

    private static List<JsonNode> hits(String json) {
        List<JsonNode> out = new ArrayList<>();
        JsonMapper.builder().build().readTree(json).get("data").forEach(out::add);
        return out;
    }

    @Test
    void tomaElLogoDelResultadoConElMismoIsin() {
        List<JsonNode> h = hits("""
                {"data":[
                  {"type":"stock","logoUrl":"/market/logos/1?v=a","primary":{"isin":"US0000000001","logoUrl":"/market/logos/1?v=a"}},
                  {"type":"stock","logoUrl":"/market/logos/2?v=b","primary":{"isin":"ES0113900J37"},
                   "matchedChild":{"isin":"ES0113900J37","logoUrl":"/market/logos/115895?v=c"}}
                ]}""");
        assertThat(FinancialHubProvider.logoPath(h, "ES0113900J37")).isEqualTo("/market/logos/115895?v=c");
    }

    @Test
    void sinCoincidenciaOSinLogoNoHayLogo() {
        List<JsonNode> h = hits("""
                {"data":[{"type":"stock","primary":{"isin":"ES0113900J37"}},
                         {"type":"stock","primary":{"isin":"US0000000001","logoUrl":"https://otro.example/x.svg"}}]}""");
        assertThat(FinancialHubProvider.logoPath(h, "ES0113900J37")).isNull();
        assertThat(FinancialHubProvider.logoPath(h, "US0000000001")).isNull();
        assertThat(FinancialHubProvider.logoPath(List.of(), "ES0113900J37")).isNull();
    }

    @Test
    void unLogoConocidoNoSePierdeSiLaBusquedaNoLoDevuelve() {
        assertThat(FinancialHubProvider.keepKnownLogo(null, "https://x/logo.svg")).isEqualTo("https://x/logo.svg");
        assertThat(FinancialHubProvider.keepKnownLogo("https://x/nuevo.svg", "https://x/logo.svg")).isEqualTo("https://x/nuevo.svg");
        assertThat(FinancialHubProvider.keepKnownLogo(null, null)).isNull();
    }
}

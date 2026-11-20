package com.cartera.util;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

/**
 * Las búsquedas de Yahoo y onvista no encuentran nada con nombres largos («wisdomtree swiss gold»), pero sí con dos
 * palabras («swiss gold»). Estas ayudas reparten la búsqueda en parejas y ordenan lo encontrado por coincidencias.
 */
public final class Words {

    private Words() {
    }

    public static String normalize(String s) {
        String plain = Normalizer.normalize(s == null ? "" : s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return plain.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", " ").trim();
    }

    public static List<String> queryWords(String q) {
        String n = normalize(q);
        return n.isEmpty() ? List.of() : Arrays.asList(n.split(" "));
    }

    /** Parejas de palabras seguidas (como mucho 3) para reintentar una búsqueda larga sin resultados. */
    public static List<String> wordPairs(String q) {
        List<String> words = queryWords(q);
        if (words.size() < 3) return List.of();
        List<String> out = new ArrayList<>();
        for (int i = 0; i < words.size() - 1 && out.size() < 3; i++) out.add(words.get(i) + " " + words.get(i + 1));
        return out;
    }

    /** Cuántas palabras de la búsqueda aparecen en el nombre. */
    public static int wordScore(String name, List<String> words) {
        String n = " " + normalize(name) + " ";
        return (int) words.stream().filter(n::contains).count();
    }

    /** Mismo nombre salvo mayúsculas, acentos y signos. */
    public static boolean sameName(String a, String b) {
        return normalize(a).equals(normalize(b));
    }

    /**
     * Junta los resultados de las parejas sin repetir (por clave) y deja los que tienen al menos dos palabras de la
     * búsqueda, los que más tienen primero.
     */
    public static <T> List<T> rankByWords(String q, List<List<T>> lists, Function<T, String> key, Function<T, String> name) {
        List<String> words = queryWords(q);
        record Scored<T>(T item, int score, int order) {
        }
        Map<String, Scored<T>> seen = new LinkedHashMap<>();
        for (List<T> list : lists) {
            for (T item : list) {
                seen.putIfAbsent(key.apply(item), new Scored<>(item, wordScore(name.apply(item), words), seen.size()));
            }
        }
        return seen.values().stream()
                .filter(x -> x.score() >= 2)
                .sorted(Comparator.comparingInt((Scored<T> x) -> -x.score()).thenComparingInt(Scored::order))
                .map(Scored::item)
                .toList();
    }
}

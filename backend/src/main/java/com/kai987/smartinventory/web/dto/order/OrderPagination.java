package com.kai987.smartinventory.web.dto.order;

import java.util.List;

import org.springframework.util.MultiValueMap;

import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;

/** Optional order-list window; omitting all three parameters preserves the legacy response. */
public record OrderPagination(boolean paged, int page, int size, boolean descending) {
    public static OrderPagination parse(MultiValueMap<String, String> query) {
        String rawPage = single(query, "page");
        String rawSize = single(query, "size");
        String sort = single(query, "sort");
        boolean paged = rawPage != null || rawSize != null || sort != null;
        int page = number(rawPage, 1, 1_000_000);
        int size = number(rawSize, 20, 100);
        if (sort != null && !sort.equals("asc") && !sort.equals("desc")) throw invalid();
        return new OrderPagination(paged, page, size, "desc".equals(sort));
    }

    private static String single(MultiValueMap<String, String> query, String name) {
        List<String> values = query.get(name);
        if (values == null) return null;
        if (values.size() != 1 || values.getFirst() == null) throw invalid();
        return values.getFirst();
    }

    private static int number(String value, int defaultValue, int maximum) {
        if (value == null) return defaultValue;
        if (!value.matches("[0-9]+")) throw invalid();
        try {
            int parsed = Integer.parseInt(value);
            if (parsed < 1 || parsed > maximum) throw invalid();
            return parsed;
        } catch (NumberFormatException exception) {
            throw invalid();
        }
    }

    public <T> List<T> select(List<T> matched) {
        if (!paged) return matched;
        List<T> ordered = descending ? matched.reversed() : matched;
        long start = (long) (page - 1) * size;
        if (start >= ordered.size()) return List.of();
        int end = (int) Math.min(start + size, ordered.size());
        return ordered.subList((int) start, end);
    }

    private static DomainException invalid() {
        return new DomainException(ErrorCode.VALIDATION_ERROR);
    }
}

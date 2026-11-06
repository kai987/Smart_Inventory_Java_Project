package com.kai987.smartinventory.web.error;

import java.io.IOException;
import java.time.Instant;
import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import tools.jackson.databind.json.JsonMapper;
import com.kai987.smartinventory.web.dto.error.ApiErrorResponse;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class ApiErrorWriter {
    private final JsonMapper jsonMapper;

    public ApiErrorWriter(JsonMapper jsonMapper) {
        this.jsonMapper = jsonMapper;
    }

    public void write(HttpServletRequest request, HttpServletResponse response,
            ErrorCode code) throws IOException {
        response.setStatus(code.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        jsonMapper.writeValue(response.getWriter(), new ApiErrorResponse(Instant.now(),
                code.status().value(), code.name(), code.defaultMessage(), request.getRequestURI(),
                List.of()));
    }
}

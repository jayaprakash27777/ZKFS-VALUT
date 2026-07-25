package com.iitjammu.zkfs.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitjammu.zkfs.dto.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.OffsetDateTime;

/**
 * Custom {@link AccessDeniedHandler} — returns a structured JSON 403 response
 * when an authenticated user lacks the required authority.
 *
 * <p>Wired into {@link com.iitjammu.zkfs.config.SecurityConfig} via
 * {@code .exceptionHandling(ex -> ex.accessDeniedHandler(...))}
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAccessDeniedHandler implements AccessDeniedHandler {

    private final ObjectMapper objectMapper;

    @Override
    public void handle(
            HttpServletRequest  request,
            HttpServletResponse response,
            AccessDeniedException accessDeniedException
    ) throws IOException {
        log.warn("403 Forbidden — insufficient permissions for path: {}", request.getRequestURI());

        ErrorResponse error = new ErrorResponse(
                403,
                "Forbidden",
                "You do not have permission to access this resource.",
                request.getRequestURI(),
                OffsetDateTime.now()
        );

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");

        objectMapper.writeValue(response.getWriter(), error);
    }
}

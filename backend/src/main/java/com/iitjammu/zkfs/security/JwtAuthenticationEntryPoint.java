package com.iitjammu.zkfs.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iitjammu.zkfs.dto.ErrorResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.OffsetDateTime;

/**
 * Custom {@link AuthenticationEntryPoint} — returns a structured JSON 401 response
 * instead of Spring Security's default HTML error page.
 *
 * <p>Triggered when:
 * <ul>
 *   <li>A request hits a protected endpoint without a JWT token.</li>
 *   <li>The JWT token is expired, malformed, or has an invalid signature.</li>
 * </ul>
 *
 * <p>Wired into {@link com.iitjammu.zkfs.config.SecurityConfig} via
 * {@code .exceptionHandling(ex -> ex.authenticationEntryPoint(...))}
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationEntryPoint implements AuthenticationEntryPoint {

    private final ObjectMapper objectMapper;

    @Override
    public void commence(
            HttpServletRequest      request,
            HttpServletResponse     response,
            AuthenticationException authException
    ) throws IOException {
        log.debug("401 Unauthorized — no valid JWT for path: {}", request.getRequestURI());

        ErrorResponse error = new ErrorResponse(
                401,
                "Unauthorized",
                "Authentication required. Please provide a valid Bearer token.",
                request.getRequestURI(),
                OffsetDateTime.now()
        );

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");

        objectMapper.writeValue(response.getWriter(), error);
    }
}

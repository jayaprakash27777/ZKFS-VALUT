package com.iitjammu.zkfs.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpHeaders;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * JWT Authentication Filter.
 *
 * <p>Runs once per request, extracts the Bearer token from the
 * {@code Authorization} header, validates it via {@link JwtService},
 * and populates the {@link SecurityContextHolder} if valid.
 *
 * <p>Flow:
 * <pre>
 *   Request → Extract "Bearer <token>" → Validate JWT → Load UserDetails
 *          → Set Authentication in SecurityContext → Continue filter chain
 * </pre>
 *
 * <p>If the token is missing, malformed, or expired, the filter simply
 * continues without setting authentication — Spring Security will then
 * reject the request with 401 Unauthorized.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService        jwtService;
    private final UserDetailsService userDetailsService;

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest  request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain         filterChain
    ) throws ServletException, IOException {

        final String authHeader = request.getHeader(HttpHeaders.AUTHORIZATION);

        // ── 1. Check for Bearer token ─────────────────────────────────────────
        if (authHeader == null || !authHeader.startsWith(BEARER_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        final String jwt   = authHeader.substring(BEARER_PREFIX.length());
        final String email;

        try {
            email = jwtService.extractSubject(jwt);
        } catch (Exception ex) {
            log.debug("Could not extract JWT subject: {}", ex.getMessage());
            filterChain.doFilter(request, response);
            return;
        }

        // ── 2. Validate and set Authentication ────────────────────────────────
        if (email != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            UserDetails userDetails = userDetailsService.loadUserByUsername(email);

            if (jwtService.isTokenValid(jwt, userDetails)) {
                UsernamePasswordAuthenticationToken authToken =
                        new UsernamePasswordAuthenticationToken(
                                userDetails,
                                null,
                                userDetails.getAuthorities()
                        );
                authToken.setDetails(
                        new WebAuthenticationDetailsSource().buildDetails(request)
                );
                SecurityContextHolder.getContext().setAuthentication(authToken);
                log.debug("JWT authenticated: user={}, path={}", email, request.getRequestURI());
            }
        }

        filterChain.doFilter(request, response);
    }

    /**
     * Skip JWT processing for public auth endpoints to avoid unnecessary
     * database lookups on every login/register request.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getServletPath();
        return path.startsWith("/v1/auth/") || path.startsWith("/actuator/health");
    }
}

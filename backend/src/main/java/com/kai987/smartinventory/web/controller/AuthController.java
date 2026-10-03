package com.kai987.smartinventory.web.controller;

import java.nio.charset.StandardCharsets;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.logout.CookieClearingLogoutHandler;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.kai987.smartinventory.domain.User;
import com.kai987.smartinventory.service.SmartInventoryService;
import com.kai987.smartinventory.web.dto.auth.CsrfResponse;
import com.kai987.smartinventory.web.dto.auth.LoginRequest;
import com.kai987.smartinventory.web.dto.auth.RegisterRequest;
import com.kai987.smartinventory.web.dto.auth.UserResponse;
import com.kai987.smartinventory.web.error.DomainException;
import com.kai987.smartinventory.web.error.ErrorCode;
import com.kai987.smartinventory.web.mapper.ApiMapper;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository contextRepository;
    private final CsrfTokenRepository csrfRepository;
    private final SmartInventoryService service;
    private final ApiMapper mapper;

    public AuthController(AuthenticationManager authenticationManager,
            SecurityContextRepository contextRepository, CsrfTokenRepository csrfRepository,
            SmartInventoryService service, ApiMapper mapper) {
        this.authenticationManager = authenticationManager;
        this.contextRepository = contextRepository;
        this.csrfRepository = csrfRepository;
        this.service = service;
        this.mapper = mapper;
    }

    @GetMapping("/csrf")
    public CsrfResponse csrf(CsrfToken token) {
        return new CsrfResponse(token.getToken(), token.getHeaderName(), token.getParameterName());
    }

    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
        User user = service.register(request.username(), request.password());
        return ResponseEntity.status(HttpStatus.CREATED).body(mapper.toUser(user));
    }

    @PostMapping("/login")
    public UserResponse login(@Valid @RequestBody LoginRequest request,
            HttpServletRequest servletRequest, HttpServletResponse servletResponse) {
        if (request.password().getBytes(StandardCharsets.UTF_8).length > 72) {
            throw new DomainException(ErrorCode.INVALID_CREDENTIALS);
        }
        try {
            Authentication authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(
                            request.username(), request.password()));
            servletRequest.getSession(true);
            servletRequest.changeSessionId();
            SecurityContext context = SecurityContextHolder.createEmptyContext();
            context.setAuthentication(authentication);
            SecurityContextHolder.setContext(context);
            contextRepository.saveContext(context, servletRequest, servletResponse);
            csrfRepository.saveToken(null, servletRequest, servletResponse);
            return service.findUser(authentication.getName()).map(mapper::toUser)
                    .orElseThrow(() -> new DomainException(ErrorCode.INVALID_CREDENTIALS));
        } catch (AuthenticationException exception) {
            throw new DomainException(ErrorCode.INVALID_CREDENTIALS);
        }
    }

    @GetMapping("/me")
    public UserResponse me(Authentication authentication) {
        return service.findUser(authentication.getName()).map(mapper::toUser)
                .orElseThrow(() -> new DomainException(ErrorCode.UNAUTHENTICATED));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response,
            Authentication authentication) {
        csrfRepository.saveToken(null, request, response);
        new SecurityContextLogoutHandler().logout(request, response, authentication);
        new CookieClearingLogoutHandler("JSESSIONID").logout(request, response, authentication);
        SecurityContextHolder.clearContext();
        return ResponseEntity.noContent().build();
    }
}

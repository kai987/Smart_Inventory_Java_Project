package com.kai987.smartinventory.service;

import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import com.kai987.smartinventory.domain.User;

@Service
public class SmartInventoryUserDetailsService implements UserDetailsService {
    private final SmartInventoryService inventoryService;

    public SmartInventoryUserDetailsService(SmartInventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = inventoryService.findUser(username)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials."));
        return org.springframework.security.core.userdetails.User.withUsername(user.getUsername())
                .password(user.getPasswordHash())
                .roles(user.getRole().name())
                .build();
    }
}

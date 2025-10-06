#!/usr/bin/env python3
"""
Script per Raspberry Pi che gestisce i button fisici e comunica con l'app Flask.
Questo script deve essere eseguito sul Raspberry Pi.
"""

import RPi.GPIO as GPIO
import requests
import time
import json
from threading import Thread

# Configurazione GPIO
BUTTON_1_PIN = 18  # GPIO 18 per "Choose Variant 1"
BUTTON_2_PIN = 19  # GPIO 19 per "Choose Variant 2"

# URL dell'applicazione Flask (modifica con l'IP del computer che esegue l'app)
FLASK_APP_URL = "http://144.178.100.238:65500"  # Sostituisci con l'IP corretto

class PhysicalButtonController:
    def __init__(self):
        self.setup_gpio()
        self.button_pressed = False
        self.last_press_time = 0
        self.debounce_time = 0.3  # 300ms debounce
        
    def setup_gpio(self):
        """Configura i pin GPIO"""
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        
        # Configura button con pull-down interno (no resistenze esterne necessarie!)
        GPIO.setup(BUTTON_1_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
        GPIO.setup(BUTTON_2_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
        
        # Callback per interrupt sui button
        GPIO.add_event_detect(BUTTON_1_PIN, GPIO.RISING, 
                             callback=self.button_1_callback, bouncetime=300)
        GPIO.add_event_detect(BUTTON_2_PIN, GPIO.RISING, 
                             callback=self.button_2_callback, bouncetime=300)
        
        print("GPIO configurato. Button 1: GPIO 18, Button 2: GPIO 19")
        
    def button_1_callback(self, channel):
        """Callback per button 1 (Choose Variant 1)"""
        current_time = time.time()
        if current_time - self.last_press_time > self.debounce_time:
            self.last_press_time = current_time
            print("Button 1 premuto - Choose Variant 1")
            self.send_button_press(1)
            
    def button_2_callback(self, channel):
        """Callback per button 2 (Choose Variant 2)"""
        current_time = time.time()
        if current_time - self.last_press_time > self.debounce_time:
            self.last_press_time = current_time
            print("Button 2 premuto - Choose Variant 2")
            self.send_button_press(2)
            
    def send_button_press(self, button_number):
        """Invia la pressione del button all'app Flask"""
        try:
            url = f"{FLASK_APP_URL}/physical-button-press"
            data = {
                'button': button_number,
                'timestamp': time.time()
            }
            
            response = requests.post(url, json=data, timeout=5)
            if response.status_code == 200:
                print(f"Button {button_number} signal inviato con successo")
            else:
                print(f"Errore nell'invio: Status {response.status_code}")
                
        except requests.exceptions.RequestException as e:
            print(f"Errore di connessione: {e}")
            
    def cleanup(self):
        """Pulizia GPIO"""
        GPIO.cleanup()
        
    def run(self):
        """Loop principale"""
        print("Controller button fisici avviato...")
        print(f"Connessione verso: {FLASK_APP_URL}")
        print("Premi Ctrl+C per terminare")
        
        try:
            # Heartbeat per verificare connessione
            self.check_connection()
            
            while True:
                time.sleep(0.1)  # Loop principale leggero
                
        except KeyboardInterrupt:
            print("\nSpegnimento...")
        finally:
            self.cleanup()
            
    def check_connection(self):
        """Verifica la connessione con l'app Flask"""
        try:
            response = requests.get(f"{FLASK_APP_URL}/health", timeout=5)
            if response.status_code == 200:
                print("✓ Connessione con l'app Flask stabilita")
            else:
                print("⚠ App Flask raggiungibile ma con problemi")
        except:
            print("✗ Impossibile connettersi all'app Flask")
            print(f"Verifica che l'app sia in esecuzione su {FLASK_APP_URL}")

if __name__ == "__main__":
    controller = PhysicalButtonController()
    controller.run()
/*
 * Automated Pet Feeder with RTC Scheduling
 * Features:
 * - Multiple feeding schedules (up to 6)
 * - 12-hour time format with AM/PM
 * - Food Only, Water Only, or Both modes
 * - EEPROM storage for schedules
 * - Keypad menu system
 * - I2C LCD display
 * - Servo for food dispensing
 * - Water pump control
 * 
 * Hardware Connections:
 * - Servo: Signal -> Pin 10
 * - Water Pump: Control -> Pin 11
 * - Keypad: Pins 2-9
 * - I2C LCD: SDA -> A4, SCL -> A5
 * - RTC DS3231: SDA -> A4, SCL -> A5
 */

#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <RTClib.h>
#include <Keypad.h>
#include <Servo.h>
#include <EEPROM.h>

// ==================== PIN DEFINITIONS ====================
#define SERVO_PIN 10
#define PUMP_PIN 11

// ==================== CONSTANTS ====================
#define MAX_SCHEDULES 6
#define PUMP_DURATION 5000  // Water pump duration in milliseconds
#define SERVO_DURATION 3000 // Servo open duration in milliseconds

// Dispense modes
#define MODE_FOOD 1
#define MODE_WATER 2
#define MODE_BOTH 3

// ==================== KEYPAD SETUP ====================
const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};
byte rowPins[ROWS] = {9, 8, 7, 6};
byte colPins[COLS] = {5, 4, 3, 2};

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

// ==================== OBJECTS ====================
LiquidCrystal_I2C lcd(0x27, 16, 2); // I2C address 0x27, 16x2 display
RTC_DS3231 rtc;
Servo servo;

// ==================== SCHEDULE STRUCTURE ====================
struct Schedule {
  byte hour;       // 1-12
  byte minute;     // 0-59
  bool isPM;       // false = AM, true = PM
  byte mode;       // 1=Food, 2=Water, 3=Both
  bool triggered;  // Prevent multiple triggers
  bool active;     // Is this schedule slot used?
};

Schedule schedules[MAX_SCHEDULES];

// ==================== GLOBAL VARIABLES ====================
unsigned long lastDisplayUpdate = 0;
int lastMinute = -1;

// ==================== EEPROM ADDRESSES ====================
#define EEPROM_START_ADDR 0
#define SCHEDULE_SIZE sizeof(Schedule)

// ==================== SETUP ====================
void setup() {
  Serial.begin(115200);  // Fixed: Match Raspberry Pi baud rate
  Serial.println(F("Pet Feeder Starting..."));
  
  // Initialize LCD
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.print(F("Pet Feeder"));
  lcd.setCursor(0, 1);
  lcd.print(F("Initializing..."));
  
  // Initialize RTC
  if (!rtc.begin()) {
    Serial.println(F("RTC not found!"));
    Serial.println(F("WARNING: Running without RTC - schedules disabled"));
    lcd.clear();
    lcd.print(F("RTC ERROR!"));
    lcd.setCursor(0, 1);
    lcd.print(F("Manual only"));
    delay(2000);
    // Continue without RTC instead of freezing
  } else {
    Serial.println(F("RTC initialized"));
    
    // Check if RTC lost power and set default time if needed
    if (rtc.lostPower()) {
      Serial.println(F("RTC lost power, setting default time"));
      // Set to Jan 1, 2024, 12:00:00 PM
      rtc.adjust(DateTime(2024, 1, 1, 12, 0, 0));
    }
  }
  
  // Initialize servo
  servo.attach(SERVO_PIN);
  servo.write(0); // Initial position
  
  // Initialize pump pin
  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);
  
  // Load schedules from EEPROM
  loadSchedulesFromEEPROM();
  
  delay(2000);
  lcd.clear();
  
  // Send ready signal for Raspberry Pi
  Serial.println(F("READY"));
  Serial.println(F("Pet Feeder System Online"));
  Serial.println(F("A=Add B=View C=Delete D=Clear"));
}

// ==================== MAIN LOOP ====================
void loop() {
  // Check for serial commands from Raspberry Pi
  if (Serial.available() > 0) {
    Serial.println(F("[DEBUG] Serial data available"));
    handleSerialCommand();
  }
  
  // Check for keypad input
  char key = keypad.getKey();
  if (key) {
    handleKeypadInput(key);
  }
  
  // Update display every second
  if (millis() - lastDisplayUpdate >= 1000) {
    lastDisplayUpdate = millis();
    updateMainDisplay();
  }
  
  // Check schedules
  checkAndExecuteSchedules();
}

// ==================== KEYPAD HANDLER ====================
void handleKeypadInput(char key) {
  Serial.print(F("Key pressed: "));
  Serial.println(key);
  
  switch (key) {
    case 'A':
      addSchedule();
      break;
    case 'B':
      viewSchedules();
      break;
    case 'C':
      deleteSchedule();
      break;
    case 'D':
      clearAllSchedules();
      break;
  }
}

// ==================== SERIAL COMMAND HANDLER ====================
void handleSerialCommand() {
  String command = Serial.readStringUntil('\n');
  command.trim();
  
  Serial.print(F("[Arduino] Received command: "));
  Serial.println(command);
  
  if (command == "DISPENSE_FOOD") {
    Serial.println(F("[Arduino] Executing DISPENSE_FOOD"));
    dispenseFoodOnly();
    Serial.println(F("FOOD_DONE"));
  } 
  else if (command == "DISPENSE_WATER") {
    Serial.println(F("[Arduino] Executing DISPENSE_WATER"));
    dispenseWaterOnly();
    Serial.println(F("WATER_DONE"));
  } 
  else if (command == "DISPENSE_BOTH") {
    Serial.println(F("[Arduino] Executing DISPENSE_BOTH"));
    dispenseBoth();
    Serial.println(F("BOTH_DONE"));
  }
  else if (command == "GET_STATUS") {
    Serial.println(F("STATUS_ONLINE"));
    Serial.print(F("SCHEDULES:"));
    Serial.println(countActiveSchedules());
    Serial.print(F("UPTIME:"));
    Serial.println(millis() / 1000);
  }
  else if (command.startsWith("ADD_SCHEDULE:")) {
    // Format: ADD_SCHEDULE:hour,minute,ampm,type
    // Example: ADD_SCHEDULE:8,30,AM,food
    handleRemoteScheduleAdd(command);
  }
  else if (command == "TEST_SERVO") {
    // Simple servo test - move slowly through positions
    Serial.println(F("Testing servo..."));
    lcd.clear();
    lcd.print(F("SERVO TEST"));
    
    Serial.println(F("Moving to 0"));
    servo.write(0);
    delay(1000);
    
    Serial.println(F("Moving to 45"));
    servo.write(45);
    delay(1000);
    
    Serial.println(F("Moving to 90"));
    servo.write(90);
    delay(1000);
    
    Serial.println(F("Moving to 135"));
    servo.write(135);
    delay(1000);
    
    Serial.println(F("Moving to 180"));
    servo.write(180);
    delay(1000);
    
    Serial.println(F("Moving back to 0"));
    servo.write(0);
    delay(1000);
    
    Serial.println(F("SERVO_TEST_DONE"));
    lcd.clear();
  }
  else {
    Serial.println(F("ERROR:UNKNOWN_COMMAND"));
  }
}

// Handle remote schedule addition from web interface
void handleRemoteScheduleAdd(String command) {
  // Parse command: ADD_SCHEDULE:8,30,AM,food
  int colonIndex = command.indexOf(':');
  if (colonIndex == -1) {
    Serial.println(F("ERROR:INVALID_FORMAT"));
    return;
  }
  
  String params = command.substring(colonIndex + 1);
  
  // Find empty slot
  int slot = -1;
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].active) {
      slot = i;
      break;
    }
  }
  
  if (slot == -1) {
    Serial.println(F("ERROR:MEMORY_FULL"));
    return;
  }
  
  // Parse parameters (simplified - would need better parsing in production)
  int comma1 = params.indexOf(',');
  int comma2 = params.indexOf(',', comma1 + 1);
  int comma3 = params.indexOf(',', comma2 + 1);
  
  if (comma1 == -1 || comma2 == -1 || comma3 == -1) {
    Serial.println(F("ERROR:INVALID_PARAMETERS"));
    return;
  }
  
  byte hour = params.substring(0, comma1).toInt();
  byte minute = params.substring(comma1 + 1, comma2).toInt();
  String ampm = params.substring(comma2 + 1, comma3);
  String type = params.substring(comma3 + 1);
  
  // Validate
  if (hour < 1 || hour > 12 || minute > 59) {
    Serial.println(F("ERROR:INVALID_TIME"));
    return;
  }
  
  // Determine mode
  byte mode = MODE_FOOD;
  if (type == "water") mode = MODE_WATER;
  else if (type == "both") mode = MODE_BOTH;
  
  // Save schedule
  schedules[slot].hour = hour;
  schedules[slot].minute = minute;
  schedules[slot].isPM = (ampm == "PM");
  schedules[slot].mode = mode;
  schedules[slot].triggered = false;
  schedules[slot].active = true;
  
  saveScheduleToEEPROM(slot);
  
  Serial.println(F("SCHEDULE_ADDED"));
}

// Count active schedules
int countActiveSchedules() {
  int count = 0;
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].active) count++;
  }
  return count;
}

// ==================== ADD SCHEDULE ====================
void addSchedule() {
  Serial.println(F("Adding new schedule..."));
  
  // Find empty slot
  int slot = -1;
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].active) {
      slot = i;
      break;
    }
  }
  
  if (slot == -1) {
    lcd.clear();
    lcd.print(F("Memory Full!"));
    lcd.setCursor(0, 1);
    lcd.print(F("Delete one first"));
    Serial.println(F("No empty slots"));
    delay(2000);
    return;
  }
  
  // Get hour (1-12)
  lcd.clear();
  lcd.print(F("Hour (1-12):"));
  lcd.setCursor(0, 1);
  byte hour = getNumberInput(1, 12, 2);
  if (hour == 0) return; // Cancelled
  
  // Get minute (00-59)
  lcd.clear();
  lcd.print(F("Minute (00-59):"));
  lcd.setCursor(0, 1);
  byte minute = getNumberInput(0, 59, 2);
  if (minute == 255) return; // Cancelled (using 255 as error code)
  
  // Get AM/PM
  lcd.clear();
  lcd.print(F("1=AM  2=PM"));
  lcd.setCursor(0, 1);
  bool isPM = false;
  char key;
  do {
    key = keypad.waitForKey();
    if (key == '*') return; // Cancel
    if (key == '1') {
      isPM = false;
      break;
    }
    if (key == '2') {
      isPM = true;
      break;
    }
  } while (true);
  
  // Get dispense mode
  lcd.clear();
  lcd.print(F("1=Food 2=Water"));
  lcd.setCursor(0, 1);
  lcd.print(F("3=Both"));
  byte mode = 0;
  do {
    key = keypad.waitForKey();
    if (key == '*') return; // Cancel
    if (key >= '1' && key <= '3') {
      mode = key - '0';
      break;
    }
  } while (true);
  
  // Save schedule
  schedules[slot].hour = hour;
  schedules[slot].minute = minute;
  schedules[slot].isPM = isPM;
  schedules[slot].mode = mode;
  schedules[slot].triggered = false;
  schedules[slot].active = true;
  
  saveScheduleToEEPROM(slot);
  
  // Send notification to Raspberry Pi
  Serial.print(F("SCHEDULE_ADDED:"));
  Serial.print(hour);
  Serial.print(F(","));
  Serial.print(minute);
  Serial.print(F(","));
  Serial.print(isPM ? F("PM") : F("AM"));
  Serial.print(F(","));
  if (mode == MODE_FOOD) Serial.println(F("food"));
  else if (mode == MODE_WATER) Serial.println(F("water"));
  else Serial.println(F("both"));
  
  // Display confirmation
  lcd.clear();
  char timeStr[16];
  sprintf(timeStr, "%d:%02d %s", hour, minute, isPM ? "PM" : "AM");
  lcd.print(timeStr);
  lcd.setCursor(0, 1);
  if (mode == MODE_FOOD) lcd.print(F("Food Added!"));
  else if (mode == MODE_WATER) lcd.print(F("Water Added!"));
  else lcd.print(F("Both Added!"));
  
  Serial.print(F("Schedule added: "));
  Serial.println(timeStr);
  
  delay(2000);
}

// ==================== VIEW SCHEDULES ====================
void viewSchedules() {
  Serial.println(F("Viewing schedules..."));
  
  int count = 0;
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].active) count++;
  }
  
  if (count == 0) {
    lcd.clear();
    lcd.print(F("No Schedules"));
    Serial.println(F("No schedules saved"));
    delay(2000);
    return;
  }
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].active) {
      lcd.clear();
      lcd.print(i + 1);
      lcd.print(F(". "));
      
      char timeStr[12];
      sprintf(timeStr, "%d:%02d %s", 
              schedules[i].hour, 
              schedules[i].minute, 
              schedules[i].isPM ? "PM" : "AM");
      lcd.print(timeStr);
      
      lcd.setCursor(0, 1);
      if (schedules[i].mode == MODE_FOOD) lcd.print(F("FOOD"));
      else if (schedules[i].mode == MODE_WATER) lcd.print(F("WATER"));
      else lcd.print(F("BOTH"));
      
      delay(2000);
    }
  }
}

// ==================== DELETE SCHEDULE ====================
void deleteSchedule() {
  Serial.println(F("Deleting schedule..."));
  
  lcd.clear();
  lcd.print(F("Enter # (1-6):"));
  lcd.setCursor(0, 1);
  
  byte schedNum = getNumberInput(1, MAX_SCHEDULES, 1);
  if (schedNum == 0) return; // Cancelled
  
  int index = schedNum - 1;
  
  if (!schedules[index].active) {
    lcd.clear();
    lcd.print(F("No schedule at"));
    lcd.setCursor(0, 1);
    lcd.print(F("that number"));
    delay(2000);
    return;
  }
  
  schedules[index].active = false;
  saveScheduleToEEPROM(index);
  
  lcd.clear();
  lcd.print(F("Schedule "));
  lcd.print(schedNum);
  lcd.setCursor(0, 1);
  lcd.print(F("Deleted!"));
  
  Serial.print(F("Schedule "));
  Serial.print(schedNum);
  Serial.println(F(" deleted"));
  
  delay(2000);
}

// ==================== CLEAR ALL SCHEDULES ====================
void clearAllSchedules() {
  Serial.println(F("Clearing all schedules..."));
  
  lcd.clear();
  lcd.print(F("Clear All?"));
  lcd.setCursor(0, 1);
  lcd.print(F("#=Yes *=No"));
  
  char key;
  do {
    key = keypad.waitForKey();
    if (key == '*') return; // Cancel
    if (key == '#') break;  // Confirm
  } while (true);
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    schedules[i].active = false;
    saveScheduleToEEPROM(i);
  }
  
  lcd.clear();
  lcd.print(F("All Cleared!"));
  Serial.println(F("All schedules cleared"));
  delay(2000);
}

// ==================== UPDATE MAIN DISPLAY ====================
void updateMainDisplay() {
  DateTime now = rtc.now();
  
  // Reset triggered flags when minute changes
  if (now.minute() != lastMinute) {
    lastMinute = now.minute();
    for (int i = 0; i < MAX_SCHEDULES; i++) {
      schedules[i].triggered = false;
    }
  }
  
  // Clear display before updating to prevent ghosting
  lcd.clear();
  
  // Line 1: Current time in 12-hour format
  lcd.setCursor(0, 0);
  byte hour12 = convert24to12(now.hour());
  bool isPM = now.hour() >= 12;
  
  char timeStr[16];
  sprintf(timeStr, "%2d:%02d:%02d %s", 
          hour12, now.minute(), now.second(), 
          isPM ? "PM" : "AM");
  lcd.print(timeStr);
  
  // Line 2: Next schedule
  lcd.setCursor(0, 1);
  int nextIdx = findNextSchedule();
  if (nextIdx == -1) {
    lcd.print(F("No Schedule     "));
  } else {
    lcd.print(F("Next: "));
    sprintf(timeStr, "%d:%02d%s ", 
            schedules[nextIdx].hour, 
            schedules[nextIdx].minute,
            schedules[nextIdx].isPM ? "PM" : "AM");
    lcd.print(timeStr);
    
    if (schedules[nextIdx].mode == MODE_FOOD) lcd.print(F("F"));
    else if (schedules[nextIdx].mode == MODE_WATER) lcd.print(F("W"));
    else lcd.print(F("B"));
  }
}

// ==================== CHECK AND EXECUTE SCHEDULES ====================
void checkAndExecuteSchedules() {
  DateTime now = rtc.now();
  byte currentHour12 = convert24to12(now.hour());
  bool currentIsPM = now.hour() >= 12;
  byte currentMinute = now.minute();
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].active && !schedules[i].triggered) {
      // Check if time matches
      if (schedules[i].hour == currentHour12 && 
          schedules[i].minute == currentMinute &&
          schedules[i].isPM == currentIsPM) {
        
        Serial.print(F("Executing schedule "));
        Serial.println(i + 1);
        
        // Mark as triggered
        schedules[i].triggered = true;
        
        // Execute based on mode
        executeDispense(schedules[i].mode);
      }
    }
  }
}

// ==================== EXECUTE DISPENSE ====================
void executeDispense(byte mode) {
  if (mode == MODE_FOOD) {
    dispenseFoodOnly();
  } else if (mode == MODE_WATER) {
    dispenseWaterOnly();
  } else if (mode == MODE_BOTH) {
    dispenseBoth();
  }
  
  // Wait before returning to main display
  delay(3000);
}

// ==================== DISPENSE FOOD ONLY ====================
void dispenseFoodOnly() {
  Serial.println(F("Dispensing food..."));
  
  lcd.clear();
  lcd.print(F("DISPENSING"));
  lcd.setCursor(0, 1);
  lcd.print(F("FOOD..."));
  
  Serial.println(F("[DEBUG] Moving servo to 180 degrees"));
  // Rotate servo to 180 degrees
  servo.write(180);
  delay(SERVO_DURATION);
  
  Serial.println(F("[DEBUG] Returning servo to 0 degrees"));
  // Return servo to 0 degrees
  servo.write(0);
  
  Serial.println(F("[DEBUG] Servo movement complete"));
  
  lcd.clear();
  lcd.print(F("FOOD"));
  lcd.setCursor(0, 1);
  lcd.print(F("DISPENSED!"));
  
  Serial.println(F("Food dispensed"));
}

// ==================== DISPENSE WATER ONLY ====================
void dispenseWaterOnly() {
  Serial.println(F("Dispensing water..."));
  
  lcd.clear();
  lcd.print(F("DISPENSING"));
  lcd.setCursor(0, 1);
  lcd.print(F("WATER..."));
  
  // Activate pump
  digitalWrite(PUMP_PIN, HIGH);
  delay(PUMP_DURATION);
  digitalWrite(PUMP_PIN, LOW);
  
  lcd.clear();
  lcd.print(F("WATER"));
  lcd.setCursor(0, 1);
  lcd.print(F("DISPENSED!"));
  
  Serial.println(F("Water dispensed"));
}

// ==================== DISPENSE BOTH ====================
void dispenseBoth() {
  Serial.println(F("Dispensing food and water..."));
  
  lcd.clear();
  lcd.print(F("DISPENSING"));
  lcd.setCursor(0, 1);
  lcd.print(F("BOTH..."));
  
  // Dispense food first
  servo.write(180);
  delay(SERVO_DURATION);
  servo.write(0);
  
  // Short delay between operations
  delay(500);
  
  // Dispense water
  digitalWrite(PUMP_PIN, HIGH);
  delay(PUMP_DURATION);
  digitalWrite(PUMP_PIN, LOW);
  
  lcd.clear();
  lcd.print(F("FOOD & WATER"));
  lcd.setCursor(0, 1);
  lcd.print(F("DONE!"));
  
  Serial.println(F("Food and water dispensed"));
}

// ==================== FIND NEXT SCHEDULE ====================
int findNextSchedule() {
  DateTime now = rtc.now();
  int currentMinutes = now.hour() * 60 + now.minute();
  
  int nextIdx = -1;
  int minDiff = 1440; // Minutes in a day
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].active) {
      // Convert schedule time to 24-hour minutes
      int schedHour24 = convert12to24(schedules[i].hour, schedules[i].isPM);
      int schedMinutes = schedHour24 * 60 + schedules[i].minute;
      
      int diff = schedMinutes - currentMinutes;
      if (diff < 0) diff += 1440; // Next day
      
      if (diff < minDiff) {
        minDiff = diff;
        nextIdx = i;
      }
    }
  }
  
  return nextIdx;
}

// ==================== TIME CONVERSION FUNCTIONS ====================

// Convert 24-hour format to 12-hour format
byte convert24to12(byte hour24) {
  if (hour24 == 0) return 12;      // Midnight (00:xx) = 12 AM
  if (hour24 <= 12) return hour24; // 1-12 stays the same
  return hour24 - 12;              // 13-23 becomes 1-11 PM
  
  // Debug examples:
  // 00:00 (midnight) -> 12 AM
  // 01:00 -> 1 AM
  // 11:00 -> 11 AM
  // 12:00 (noon) -> 12 PM
  // 13:00 -> 1 PM
  // 23:00 -> 11 PM
}

// Convert 12-hour format to 24-hour format
byte convert12to24(byte hour12, bool isPM) {
  if (hour12 == 12) {
    return isPM ? 12 : 0;  // 12 PM = 12, 12 AM = 0
  }
  return isPM ? hour12 + 12 : hour12;
}

// ==================== INPUT HELPER FUNCTION ====================
byte getNumberInput(byte minVal, byte maxVal, byte digits) {
  String input = "";
  char key;
  byte cursorPos = 0;
  
  while (true) {
    key = keypad.waitForKey();
    
    // Cancel with *
    if (key == '*') {
      Serial.println(F("Input cancelled"));
      return 0; // Return 0 to indicate cancellation
    }
    
    // Confirm with #
    if (key == '#') {
      if (input.length() > 0) {
        int value = input.toInt();
        if (value >= minVal && value <= maxVal) {
          Serial.print(F("Input: "));
          Serial.println(value);
          return (byte)value;
        } else {
          lcd.setCursor(0, 1);
          lcd.print(F("Invalid! Retry  "));
          delay(1000);
          lcd.setCursor(0, 1);
          lcd.print(F("                "));
          lcd.setCursor(0, 1);
          input = "";
          cursorPos = 0;
        }
      }
      continue;
    }
    
    // Number input
    if (key >= '0' && key <= '9' && input.length() < digits) {
      input += key;
      lcd.print(key);
      cursorPos++;
    }
  }
}

// ==================== EEPROM FUNCTIONS ====================

// Save single schedule to EEPROM
void saveScheduleToEEPROM(int index) {
  int addr = EEPROM_START_ADDR + (index * SCHEDULE_SIZE);
  EEPROM.put(addr, schedules[index]);
  
  Serial.print(F("Schedule "));
  Serial.print(index);
  Serial.println(F(" saved to EEPROM"));
}

// Load all schedules from EEPROM
void loadSchedulesFromEEPROM() {
  Serial.println(F("Loading schedules from EEPROM..."));
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    int addr = EEPROM_START_ADDR + (i * SCHEDULE_SIZE);
    EEPROM.get(addr, schedules[i]);
    
    // Validate loaded data
    if (schedules[i].hour < 1 || schedules[i].hour > 12 ||
        schedules[i].minute > 59 ||
        schedules[i].mode < 1 || schedules[i].mode > 3) {
      schedules[i].active = false;
    }
    
    if (schedules[i].active) {
      Serial.print(F("Loaded schedule "));
      Serial.print(i);
      Serial.print(F(": "));
      Serial.print(schedules[i].hour);
      Serial.print(F(":"));
      Serial.print(schedules[i].minute);
      Serial.println(schedules[i].isPM ? F(" PM") : F(" AM"));
    }
  }
  
  Serial.println(F("Schedules loaded"));
}

// ==================== OPTIONAL: SET RTC TIME ====================
// Uncomment and call this function from setup() if you need to set RTC time via keypad
/*
void setRTCTime() {
  Serial.println(F("Setting RTC time..."));
  
  lcd.clear();
  lcd.print(F("Set RTC Time"));
  delay(1500);
  
  // Get hour (1-12)
  lcd.clear();
  lcd.print(F("Hour (1-12):"));
  lcd.setCursor(0, 1);
  byte hour = getNumberInput(1, 12, 2);
  if (hour == 0) return;
  
  // Get minute (00-59)
  lcd.clear();
  lcd.print(F("Minute (00-59):"));
  lcd.setCursor(0, 1);
  byte minute = getNumberInput(0, 59, 2);
  if (minute == 255) return;
  
  // Get second (00-59)
  lcd.clear();
  lcd.print(F("Second (00-59):"));
  lcd.setCursor(0, 1);
  byte second = getNumberInput(0, 59, 2);
  if (second == 255) return;
  
  // Get AM/PM
  lcd.clear();
  lcd.print(F("1=AM  2=PM"));
  lcd.setCursor(0, 1);
  bool isPM = false;
  char key;
  do {
    key = keypad.waitForKey();
    if (key == '*') return;
    if (key == '1') {
      isPM = false;
      break;
    }
    if (key == '2') {
      isPM = true;
      break;
    }
  } while (true);
  
  // Convert to 24-hour format and set RTC
  byte hour24 = convert12to24(hour, isPM);
  
  // Get current date or set default
  DateTime now = rtc.now();
  rtc.adjust(DateTime(now.year(), now.month(), now.day(), hour24, minute, second));
  
  lcd.clear();
  lcd.print(F("RTC Time Set!"));
  lcd.setCursor(0, 1);
  char timeStr[16];
  sprintf(timeStr, "%d:%02d:%02d %s", hour, minute, second, isPM ? "PM" : "AM");
  lcd.print(timeStr);
  
  Serial.print(F("RTC set to: "));
  Serial.println(timeStr);
  
  delay(3000);
}
*/

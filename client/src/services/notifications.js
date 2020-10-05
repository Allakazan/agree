const NotificationAPI = {
    userActive: true,
    notificationPermission: false,
    notificationDebounceTime: 30000,
    notificationOptions: {
        icon: '/favicon.ico'
    },
    userNotified: false,

    handleActiveUser() {
        NotificationAPI.userActive = true;
    },

    handleInativeUser() {
        NotificationAPI.userActive = false;
    },

    init() {
        window.addEventListener('focus', NotificationAPI.handleActiveUser);
        window.addEventListener('blur', NotificationAPI.handleInativeUser);

        if (window.Notification.permission !== "granted") {
            window.Notification.requestPermission((permission) => NotificationAPI.notificationPermission = permission === "granted");
        } else {
            NotificationAPI.notificationPermission = true
        }
    },

    destroy() {
        window.removeEventListener('focus', NotificationAPI.handleActiveUser);
        window.removeEventListener('blur', NotificationAPI.handleInativeUser);
    },

    shouldNotifyUser() {
        return !NotificationAPI.userActive && !NotificationAPI.userNotified;
    },

    notify(message) {
        if (NotificationAPI.notificationPermission) {
            new Notification(message, NotificationAPI.notificationOptions);
            
            NotificationAPI.userNotified = true;

            setTimeout(() => NotificationAPI.userNotified = false, NotificationAPI.notificationDebounceTime)
        }
    }

};

export default NotificationAPI;
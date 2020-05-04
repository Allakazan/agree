const NotificationAPI = {
    userActive: true,
    notificationPermission: false,
    notificationOptions: {
        icon: '/favicon.ico'
    },

    handleActiveUser() {
        console.log('ENTROU')
        NotificationAPI.userActive = true;
    },

    handleInativeUser() {
        console.log('SAIU')
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
        return !NotificationAPI.userActive;
    },

    notify(message) {
        if (NotificationAPI.notificationPermission) {
            const newNotification = new Notification(message, NotificationAPI.notificationOptions);
            
        }
    }

};

export default NotificationAPI;